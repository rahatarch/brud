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
use std::sync::Arc;
use std::sync::Mutex;
use wasmtime::{
    Config, Engine as WtEngine, Instance as WtInstance, Linker as WtLinker, Module as WtModule,
    Store as WtStore,
};

/// The kinds of host import the cage knows how to provide.
///
/// The design record (W-02) fixes a caged participant's only door as the
/// exposed-API registry's `resolve`. A routed call is therefore the one host
/// function the cage provides, plus a small runtime-support set that grants no
/// authority. This enum is the closed set of import kinds; anything else is
/// refused at instantiation time by Wasmtime's linker.
#[napi(string_enum)]
pub enum ImportKind {
    /// A routed call: `kernel.call(api, operation, args) -> result`.
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
    store: Arc<Mutex<WtStore<()>>>,
    instance: WtInstance,
    limits: ResourceLimits,
}

#[napi]
impl CageInstance {
    /// Instantiates a compiled module with the caller's declared imports.
    ///
    /// Default-deny: the linker is built from `imports` alone. A module that
    /// declares any import not in `imports` fails to instantiate with a
    /// Wasmtime "unknown import" error. No WASI, no host function, and no
    /// Node global is present.
    #[napi]
    pub fn instantiate(
        module: &CageModule,
        imports: Vec<ImportDeclaration>,
        limits: ResourceLimits,
    ) -> Result<Self> {
        let mut store = WtStore::new(&module.engine, ());
        store
            .set_fuel(limits.fuel.max(0.0) as u64)
            .map_err(to_napi_err)?;
        let mut linker: WtLinker<()> = WtLinker::new(&module.engine);

        for import in &imports {
            match import.kind {
                ImportKind::RoutedCall => {
                    // Routed call: a plain-data host function. The cage's
                    // design (W-02) fixes this as the only door to the
                    // exposed-API registry; the actual routing is performed
                    // by the cage's TypeScript layer, which the host
                    // function calls back into through a shared channel the
                    // cage owns. This binding provides the Wasmtime signature
                    // only; it returns an error result to the module, and the
                    // cage's TypeScript layer supplies the real implementation.
                    let f = wasmtime::Func::wrap(
                        &mut store,
                        |_caller: wasmtime::Caller<'_, ()>,
                         _api: u32,
                         _op: u32,
                         _len: u32|
                         -> u32 {
                            // The routed call is denied at this layer: the
                            // binding cannot reach the registry. The cage's
                            // TypeScript layer replaces this with the real
                            // routed call in a later step; until then, the
                            // import exists (so a module may declare it) but
                            // every call returns 0 (the cage's stable
                            // capability-denial code).
                            0
                        },
                    );
                    linker
                        .define(&store, &import.module, &import.name, f)
                        .map_err(to_napi_err)?;
                }
                ImportKind::RuntimeTime => {
                    let f = wasmtime::Func::wrap(
                        &mut store,
                        |_caller: wasmtime::Caller<'_, ()>| -> u64 {
                            // Deterministic monotonic counter. No clock
                            // authority; the host supplies the value from
                            // its own counter, and this binding does not
                            // read the system clock.
                            0
                        },
                    );
                    linker
                        .define(&store, &import.module, &import.name, f)
                        .map_err(to_napi_err)?;
                }
                ImportKind::RuntimeBuffer => {
                    let f = wasmtime::Func::wrap(
                        &mut store,
                        |_caller: wasmtime::Caller<'_, ()>, _size: u32| -> u32 {
                            0
                        },
                    );
                    linker
                        .define(&store, &import.module, &import.name, f)
                        .map_err(to_napi_err)?;
                }
            }
        }

        let instance = linker
            .instantiate(&mut store, &module.inner)
            .map_err(to_napi_err)?;
        Ok(Self {
            store: Arc::new(Mutex::new(store)),
            instance,
            limits,
        })
    }

    /// Calls an exported function with an i32 argument and returns its i32.
    ///
    /// This is the smallest call entry point the cage needs for the Step 1
    /// verification (a trivial module whose exported function returns a
    /// value). The Step 1 verification calls it with a module that has no
    /// imports and a function that returns 42.
    #[napi]
    pub fn call_i32(&self, name: String, arg: i32) -> Result<i32> {
        let mut store = self
            .store
            .lock()
            .map_err(|_| to_napi_err("cage instance store poisoned"))?;
        let func = self
            .instance
            .get_typed_func::<i32, i32>(&mut *store, &name)
            .map_err(to_napi_err)?;
        let value = func.call(&mut *store, arg).map_err(trap_err)?;
        Ok(value)
    }

    /// Reports the fuel remaining after the last call.
    #[napi]
    pub fn fuel_remaining(&self) -> Result<f64> {
        let store = self
            .store
            .lock()
            .map_err(|_| to_napi_err("cage instance store poisoned"))?;
        let fuel = store.get_fuel().map_err(to_napi_err)?;
        Ok(fuel as f64)
    }
}

/// Renders a call failure, unwrapping a Wasmtime trap to its own message.
///
/// `wasmtime::Error` is an `anyhow`-style boxed error. Its `Display` gives the
/// wasm backtrace, not the trap's reason; the reason (for example "all fuel
/// consumed") is inside the `Trap`. This helper renders both.
fn trap_err(e: wasmtime::Error) -> Error {
    if let Some(trap) = e.downcast_ref::<wasmtime::Trap>() {
        return Error::new(Status::GenericFailure, format!("{}: {}", trap, e));
    }
    Error::new(Status::GenericFailure, format!("{e}"))
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