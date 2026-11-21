// Runs once before the participant's code. It gives the guest the whole
// "outside world": no console output, no clock, no Node APIs, and a single way
// out, brud.call, which is the cage's routed call.
(function (native) {
  const quiet = () => undefined;

  globalThis.console = Object.freeze({ log: quiet, info: quiet, warn: quiet, error: quiet, debug: quiet });
  Date.now = () => 0;

  globalThis.brud = Object.freeze({
    /** Calls `method` of another exposure as this participant. Throws when the call is refused. */
    call(name, method, args = [], version) {
      const request = version === undefined ? { name, method, args } : { name, version, method, args };
      const answer = JSON.parse(native(JSON.stringify(request)));

      if (answer.ok === true) {
        return answer.value;
      }

      const failure = new Error(answer.error.message);

      failure.code = answer.error.code;
      throw failure;
    },
  });

  globalThis.__brud_dispatch = function (raw) {
    try {
      if (typeof globalThis.handler !== 'function') {
        throw Object.assign(new Error('the participant exports no handler function (use `export default function handler(request)`)'), { code: 'GUEST_NO_HANDLER' });
      }

      const value = globalThis.handler(JSON.parse(raw));

      if (value !== null && typeof value === 'object' && typeof value.then === 'function') {
        throw Object.assign(new Error('async handlers are not supported; brud.call is synchronous'), { code: 'GUEST_ASYNC_HANDLER' });
      }

      return JSON.stringify({ ok: true, value: value === undefined ? null : value });
    } catch (error) {
      const code = error !== null && typeof error === 'object' && typeof error.code === 'string' ? error.code : 'GUEST_THROWN';
      const message = error !== null && typeof error === 'object' && 'message' in error ? String(error.message) : String(error);

      return JSON.stringify({ ok: false, error: { code, message } });
    }
  };

  delete globalThis.__brud_native_call;
})(globalThis.__brud_native_call);
