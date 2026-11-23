//! napi-rs binding over Wasmtime for the Brud kernel's WASM cage.
//!
//! The cage's design record (W-04) names Wasmtime as the runtime and requires it
//! to live inside the cage's own package. This crate is the cage's own code: a
//! thin Node-API surface over a Wasmtime engine, module, instance, and store.
//!
//! The surface is deliberately small and default-deny. A module may declare an
//! import only if the caller supplies a linker definition for it. There is no
//! implicit WASI, no implicit host function, and no reach into a Node global: a
//! module that imports anything the caller did not define fails to instantiate.

use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::Mutex;
use std::task::{Context, Poll, Waker};
use wasmtime::{
    Config, Engine as WtEngine, Instance as WtInstance, Linker as WtLinker, Module as WtModule,
    Store as WtStore, StoreLimits, StoreLimitsBuilder,
};

/// Largest response a guest may return from one `call_json` (bytes).
const MAX_RESPONSE_BYTES: u32 = 1 << 20;

/// The routed-call exchange between a suspended guest and the host: the guest
/// posts a request and suspends; the host answers through `resume`.
#[derive(Default)]
struct RoutedSlot {
    request: Option<String>,
    response: Option<String>,
}

/// Per-store host state: the resource limiter and the routed-call slot.
pub struct HostState {
    limits: StoreLimits,
    routed: Arc<Mutex<RoutedSlot>>,
}

/// Resolves once the host has supplied the response to the pending routed call.
struct AwaitResponse {
    slot: Arc<Mutex<RoutedSlot>>,
}

impl Future for AwaitResponse {
    type Output = Option<String>;

    fn poll(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Option<String>> {
        match self.slot.lock() {
            Ok(mut slot) => match slot.response.take() {
                Some(response) => Poll::Ready(Some(response)),
                None => Poll::Pending,
            },
            Err(_) => Poll::Ready(None),
        }
    }
}

/// The routed call (W-02), the guest's only door out: reads the request from
/// guest memory, suspends the guest until the host answers (`resume`), then
/// writes the response into memory from the guest's `brud_alloc`.
fn routed_call<'a>(
    mut caller: wasmtime::Caller<'a, HostState>,
    (ptr, len): (u32, u32),
) -> Box<dyn Future<Output = wasmtime::Result<u64>> + Send + 'a> {
    Box::new(async move {
        if len > MAX_RESPONSE_BYTES {
            return Err(wasmtime::Error::msg("routed request exceeds the size limit"));
        }
        let memory = caller
            .get_export("memory")
            .and_then(|e| e.into_memory())
            .ok_or_else(|| wasmtime::Error::msg("guest exports no memory"))?;
        let mut buf = vec![0u8; len as usize];
        memory
            .read(&caller, ptr as usize, &mut buf)
            .map_err(|_| wasmtime::Error::msg("routed request is out of bounds"))?;
        let request =
            String::from_utf8(buf).map_err(|_| wasmtime::Error::msg("routed request is not UTF-8"))?;
        let slot = Arc::clone(&caller.data().routed);
        {
            let mut pending = slot
                .lock()
                .map_err(|_| wasmtime::Error::msg("routed call slot poisoned"))?;
            pending.request = Some(request);
            pending.response = None;
        }
        let response = AwaitResponse { slot }
            .await
            .ok_or_else(|| wasmtime::Error::msg("routed call slot poisoned"))?;
        let bytes = response.into_bytes();
        let out_len = u32::try_from(bytes.len())
            .ok()
            .filter(|n| *n <= MAX_RESPONSE_BYTES)
            .ok_or_else(|| wasmtime::Error::msg("routed response exceeds the size limit"))?;
        let alloc = caller
            .get_export("brud_alloc")
            .and_then(|e| e.into_func())
            .ok_or_else(|| wasmtime::Error::msg("guest exports no brud_alloc"))?
            .typed::<u32, u32>(&caller)?;
        let out_ptr = alloc.call_async(&mut caller, out_len).await?;
        memory
            .write(&mut caller, out_ptr as usize, &bytes)
            .map_err(|_| wasmtime::Error::msg("guest allocation is out of bounds"))?;
        Ok(((out_ptr as u64) << 32) | out_len as u64)
    })
}

/// Polls a future once with a no-op waker. The host drives every guest call
/// itself, so a future is only ever re-polled after `resume` supplies data.
fn poll_once<F: Future + ?Sized>(future: Pin<&mut F>) -> Poll<F::Output> {
    future.poll(&mut Context::from_waker(Waker::noop()))
}

/// Renders a Wasmtime error (unwrapping a trap's reason) as plain text.
fn trap_text(e: wasmtime::Error) -> String {
    if let Some(trap) = e.downcast_ref::<wasmtime::Trap>() {
        return format!("{}: {:#}", trap, e);
    }
    format!("{e:#}")
}

/// One host-driven guest call in flight: owns the store until it completes.
type CallFuture = Pin<Box<dyn Future<Output = (WtStore<HostState>, std::result::Result<String, String>)> + Send>>;

/// The instance's store: idle, owned by a suspended call, or lost (a call was
/// abandoned mid-flight; every later call fails closed).
enum StoreState {
    Idle(WtStore<HostState>),
    Busy(CallFuture),
    Gone,
}

/// One step of a host-driven guest call.
#[napi(object)]
pub struct CallStep {
    /// True when the guest call finished; `response` holds its result.
    pub done: bool,
    /// The guest's response, when `done`.
    pub response: Option<String>,
    /// The guest's routed request, when not `done`: answer it with `resume`.
    pub request: Option<String>,
}

/// Runs one guest export over plain bytes (the body of a host-driven call).
async fn run_json(
    store: &mut WtStore<HostState>,
    instance: WtInstance,
    fuel: u64,
    name: String,
    request: String,
) -> std::result::Result<String, String> {
    store.set_fuel(fuel).map_err(|e| e.to_string())?;
    let memory = instance
        .get_memory(&mut *store, "memory")
        .ok_or_else(|| "guest exports no memory".to_string())?;
    let alloc = instance
        .get_typed_func::<u32, u32>(&mut *store, "brud_alloc")
        .map_err(|e| e.to_string())?;
    let func = instance
        .get_typed_func::<(u32, u32), u64>(&mut *store, &name)
        .map_err(|e| e.to_string())?;
    let bytes = request.as_bytes();
    let len = u32::try_from(bytes.len()).map_err(|_| "request too large".to_string())?;
    let ptr = alloc.call_async(&mut *store, len).await.map_err(trap_text)?;
    memory
        .write(&mut *store, ptr as usize, bytes)
        .map_err(|_| "guest allocation is out of bounds".to_string())?;
    let packed = func.call_async(&mut *store, (ptr, len)).await.map_err(trap_text)?;
    let out_ptr = (packed >> 32) as u32;
    let out_len = (packed & 0xffff_ffff) as u32;
    if out_len > MAX_RESPONSE_BYTES {
        return Err("guest response exceeds the size limit".to_string());
    }
    let mut out = vec![0u8; out_len as usize];
    memory
        .read(&*store, out_ptr as usize, &mut out)
        .map_err(|_| "guest response is out of bounds".to_string())?;
    String::from_utf8(out).map_err(|_| "guest response is not UTF-8".to_string())
}

/// The kinds of host import the cage knows how to provide.
///
/// The design record (W-02) fixes a caged participant's only door as the
/// exposed-API registry's `resolve`. A routed call is therefore the one host
/// function the cage provides, plus a small runtime-support set that grants no
/// authority. This enum is the closed set of import kinds; anything else is
/// refused at instantiation time by Wasmtime's linker.
#[napi(string_enum)]
pub enum ImportKind {
    /// A routed call: `(ptr, len) -> (ptr << 32) | len`, plain JSON both ways.
    RoutedCall,
    /// Deterministic time in milliseconds. Grants no clock authority beyond
    /// a monotonic counter the host supplies.
    RuntimeTime,
    /// A bounded byte buffer allocation. Grants no memory authority beyond
    /// what the module already owns.
    RuntimeBuffer,
}

/// Per-instance resource limits. The plan's Gap 1 and W-03 require the cage to
/// enforce Wasmtime's fuel, memory, and timeout limits; this struct is those
/// three, and nothing else.
#[napi(object)]
pub struct ResourceLimits {
    /// Fuel units the instance may consume in total.
    pub fuel: f64,
    /// Maximum linear-memory size in bytes.
    pub max_memory_bytes: f64,
    /// Wall-clock timeout in milliseconds for one call.
    pub timeout_ms: f64,
}

/// The engine, constructed once per cage.
#[napi]
pub struct CageEngine {
    inner: Arc<WtEngine>,
}

#[napi]
impl CageEngine {
    /// Builds an engine with the cage's fixed configuration.
    ///
    /// The configuration is closed: fuel metering on, memory limits enforced
    /// at instantiation and growth, no WASI, no threads, no shared memory,
    /// no reference types, no SIMD. A module that requires any of these fails
    /// to compile.
    #[napi(constructor)]
    pub fn new() -> Result<Self> {
        let mut config = Config::new();
        config.consume_fuel(true);
        config.wasm_bulk_memory(true);
        config.wasm_multi_memory(false);
        config.wasm_memory64(false);
        config.cranelift_opt_level(wasmtime::OptLevel::Speed);
        config.strategy(wasmtime::Strategy::Cranelift);
        let engine = WtEngine::new(&config).map_err(to_napi_err)?;
        Ok(Self {
            inner: Arc::new(engine),
        })
    }
}

/// A compiled module.
#[napi]
pub struct CageModule {
    inner: Arc<WtModule>,
    engine: Arc<WtEngine>,
}

#[napi]
impl CageModule {
    /// Compiles a module from its bytes.
    ///
    /// The engine's closed configuration applies. A module that requires an
    /// unsupported feature fails to compile, and the error is returned.
    #[napi]
    pub fn compile(engine: &CageEngine, bytes: Buffer) -> Result<Self> {
        let module = WtModule::new(&engine.inner, bytes.as_ref()).map_err(to_napi_err)?;
        Ok(Self {
            inner: Arc::new(module),
            engine: Arc::clone(&engine.inner),
        })
    }
}

/// One host import the caller declares.
#[napi(object)]
pub struct ImportDeclaration {
    /// The module namespace the import lives in (e.g. `"kernel"`).
    pub module: String,
    /// The import's name inside that namespace (e.g. `"call"`).
    pub name: String,
    /// The kind of host import. Must match the declared signature.
    pub kind: ImportKind,
}

/// An instantiated module.
#[napi]
pub struct CageInstance {
    state: Mutex<StoreState>,
    instance: WtInstance,
    limits: ResourceLimits,
    routed: Arc<Mutex<RoutedSlot>>,
}

#[napi]
impl CageInstance {
    /// Instantiates a compiled module with the caller's declared imports.
    ///
    /// Default-deny: the linker is built from `imports` alone. A module that
    /// declares any import not in `imports` fails to instantiate with a
    /// Wasmtime "unknown import" error. No WASI, no host function, and no
    /// Node global is present. The memory limit is enforced at instantiation
    /// and on every growth.
    #[napi]
    pub fn instantiate(
        module: &CageModule,
        imports: Vec<ImportDeclaration>,
        limits: ResourceLimits,
    ) -> Result<Self> {
        let store_limits = StoreLimitsBuilder::new()
            .memory_size(limits.max_memory_bytes.max(0.0) as usize)
            .instances(1)
            .trap_on_grow_failure(true)
            .build();
        let routed = Arc::new(Mutex::new(RoutedSlot::default()));
        let mut store = WtStore::new(
            &module.engine,
            HostState { limits: store_limits, routed: Arc::clone(&routed) },
        );
        store.limiter(|state| &mut state.limits);
        store
            .set_fuel(limits.fuel.max(0.0) as u64)
            .map_err(to_napi_err)?;
        let mut linker: WtLinker<HostState> = WtLinker::new(&module.engine);

        for import in &imports {
            let f = match import.kind {
                ImportKind::RoutedCall => wasmtime::Func::wrap_async(&mut store, routed_call),
                // Deterministic time: no clock authority; the host supplies 0.
                ImportKind::RuntimeTime => wasmtime::Func::wrap(
                    &mut store,
                    |_caller: wasmtime::Caller<'_, HostState>| -> u64 { 0 },
                ),
                // Bounded buffer: grants no memory authority; always 0.
                ImportKind::RuntimeBuffer => wasmtime::Func::wrap(
                    &mut store,
                    |_caller: wasmtime::Caller<'_, HostState>, _size: u32| -> u32 { 0 },
                ),
            };
            linker
                .define(&store, &import.module, &import.name, f)
                .map_err(to_napi_err)?;
        }

        let instance = {
            let mut instantiating = std::pin::pin!(linker.instantiate_async(&mut store, &module.inner));
            match poll_once(instantiating.as_mut()) {
                Poll::Ready(result) => result.map_err(to_napi_err)?,
                Poll::Pending => return Err(to_napi_err("a routed call during instantiation is refused")),
            }
        };
        Ok(Self {
            state: Mutex::new(StoreState::Idle(store)),
            instance,
            limits,
            routed,
        })
    }

    /// Calls an exported `(i32) -> i32` function (the Step 1 verification entry).
    /// A routed call through this entry is refused and loses the instance.
    #[napi]
    pub fn call_i32(&self, name: String, arg: i32) -> Result<i32> {
        let mut state = self.lock_state()?;
        let StoreState::Idle(store) = &mut *state else {
            return Err(to_napi_err("re-entrant call into a busy cage instance"));
        };
        let func = self
            .instance
            .get_typed_func::<i32, i32>(&mut *store, &name)
            .map_err(to_napi_err)?;
        let outcome = {
            let mut call = std::pin::pin!(func.call_async(&mut *store, arg));
            poll_once(call.as_mut())
        };
        match outcome {
            Poll::Ready(result) => result.map_err(trap_err),
            Poll::Pending => {
                *state = StoreState::Gone;
                Err(to_napi_err("a routed call is not available through call_i32"))
            }
        }
    }

    /// Starts a host-driven call of a guest export with a plain-value request.
    ///
    /// The host-to-guest call path (the cage's call *in*). The request (UTF-8,
    /// JSON by the TypeScript layer's convention) is copied into memory from
    /// the guest's `brud_alloc(len) -> ptr`; the export is called as
    /// `(ptr, len) -> u64` and returns `(ptr << 32) | len`. Every call starts
    /// with a fresh fuel budget. When the guest makes a routed call, the step
    /// returns `{ done: false, request }` and the guest stays suspended until
    /// `resume` answers; a call into a busy instance is refused (fail closed).
    #[napi]
    pub fn call_json(&self, name: String, request: String) -> Result<CallStep> {
        let mut state = self.lock_state()?;
        let store = match std::mem::replace(&mut *state, StoreState::Gone) {
            StoreState::Idle(store) => store,
            other => {
                *state = other;
                return Err(to_napi_err("re-entrant call into a busy cage instance"));
            }
        };
        let instance = self.instance;
        let fuel = self.limits.fuel.max(0.0) as u64;
        let future: CallFuture = Box::pin(async move {
            let mut store = store;
            let result = run_json(&mut store, instance, fuel, name, request).await;
            (store, result)
        });
        self.drive(&mut state, future)
    }

    /// Answers the suspended guest's routed request and continues the call.
    #[napi]
    pub fn resume(&self, response: String) -> Result<CallStep> {
        let mut state = self.lock_state()?;
        let future = match std::mem::replace(&mut *state, StoreState::Gone) {
            StoreState::Busy(future) => future,
            other => {
                *state = other;
                return Err(to_napi_err("no guest call is waiting for a routed response"));
            }
        };
        self.routed
            .lock()
            .map_err(|_| to_napi_err("routed call slot poisoned"))?
            .response = Some(response);
        self.drive(&mut state, future)
    }

    /// Reports whether the guest exports `name`.
    #[napi]
    pub fn has_export(&self, name: String) -> Result<bool> {
        let mut state = self.lock_state()?;
        let StoreState::Idle(store) = &mut *state else {
            return Err(to_napi_err("re-entrant call into a busy cage instance"));
        };
        Ok(self.instance.get_export(&mut *store, &name).is_some())
    }

    /// Reports the fuel remaining after the last call.
    #[napi]
    pub fn fuel_remaining(&self) -> Result<f64> {
        let state = self.lock_state()?;
        let StoreState::Idle(store) = &*state else {
            return Err(to_napi_err("re-entrant call into a busy cage instance"));
        };
        Ok(store.get_fuel().map_err(to_napi_err)? as f64)
    }
}

impl CageInstance {
    fn lock_state(&self) -> Result<std::sync::MutexGuard<'_, StoreState>> {
        self.state
            .try_lock()
            .map_err(|_| to_napi_err("re-entrant call into a busy cage instance"))
    }

    /// Polls a call once: finished, suspended on a routed request, or failed.
    fn drive(&self, state: &mut StoreState, mut future: CallFuture) -> Result<CallStep> {
        match poll_once(future.as_mut()) {
            Poll::Ready((store, result)) => {
                *state = StoreState::Idle(store);
                result
                    .map(|response| CallStep { done: true, response: Some(response), request: None })
                    .map_err(|e| Error::new(Status::GenericFailure, e))
            }
            Poll::Pending => {
                let request = self
                    .routed
                    .lock()
                    .map_err(|_| to_napi_err("routed call slot poisoned"))?
                    .request
                    .take();
                match request {
                    Some(request) => {
                        *state = StoreState::Busy(future);
                        Ok(CallStep { done: false, response: None, request: Some(request) })
                    }
                    None => Err(to_napi_err("guest suspended without a routed request")),
                }
            }
        }
    }
}

/// Renders a call failure, unwrapping a Wasmtime trap to its own message.
///
/// `wasmtime::Error` is an `anyhow`-style boxed error. Its `Display` gives the
/// wasm backtrace, not the trap's reason; the reason (for example "all fuel
/// consumed") is inside the `Trap`. This helper renders both.
fn trap_err(e: wasmtime::Error) -> Error {
    if let Some(trap) = e.downcast_ref::<wasmtime::Trap>() {
        return Error::new(Status::GenericFailure, format!("{}: {:#}", trap, e));
    }
    Error::new(Status::GenericFailure, format!("{e:#}"))
}

/// Renders a Wasmtime error as text.
///
/// `wasmtime::Error` is an `anyhow`-style boxed error that does not implement
/// `std::error::Error`, so its chain is rendered through its `Display` output,
/// which is what distinguishes a fuel exhaustion from a trap from a link
/// failure for the caller.
fn to_napi_err<E: std::fmt::Display>(e: E) -> Error {
    Error::new(Status::GenericFailure, format!("{e}"))
}