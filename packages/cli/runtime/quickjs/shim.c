// The Brud guest ABI around QuickJS: one WASM module the cage can run.
//
// Exports brud_alloc / brud_invoke (the cage's guest interface) and imports
// brud.call (its only way out). The participant's bundled script lives in a
// fixed slot inside this module; `brud pack` writes it there, so a package is
// this exact runtime plus one script, and the runtime is never rebuilt per package.
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "quickjs.h"
#include "prelude.h"

#define SLOT_CAPACITY (256 * 1024)

// Layout, little endian: 16-byte marker, u32 capacity, u32 script length, script bytes, NUL.
// `brud pack` finds the marker in the .wasm and fills in length and script.
__attribute__((used)) static volatile unsigned char script_slot[16 + 4 + 4 + SLOT_CAPACITY + 1] = {
  'B', 'R', 'U', 'D', '-', 'J', 'S', '-', 'S', 'L', 'O', 'T', '-', 'v', '1', 0,
  (SLOT_CAPACITY) & 0xff, (SLOT_CAPACITY >> 8) & 0xff, (SLOT_CAPACITY >> 16) & 0xff, (SLOT_CAPACITY >> 24) & 0xff,
};

__attribute__((import_module("brud"), import_name("call")))
extern int64_t brud_call(int32_t ptr, int32_t len);

static JSRuntime *rt;
static JSContext *ctx;
static JSValue dispatch;
static const char *boot_error;

__attribute__((export_name("brud_alloc")))
int32_t brud_alloc(int32_t len) {
  return (int32_t)(intptr_t)malloc((size_t)len + 1);
}

static int64_t pack(char *text, size_t len) {
  return ((int64_t)(intptr_t)text << 32) | (int64_t)len;
}

static int64_t fail(const char *code, const char *message) {
  size_t size = strlen(code) + strlen(message) + 48;
  char *out = malloc(size);
  size_t used = 0;
  const char *parts[] = { "{\"ok\":false,\"error\":{\"code\":\"", code, "\",\"message\":\"" };

  for (int i = 0; i < 3; i += 1) {
    size_t n = strlen(parts[i]);

    memcpy(out + used, parts[i], n);
    used += n;
  }

  // Escape the message so the answer is always valid JSON.
  for (const char *c = message; *c != 0 && used + 8 < size; c += 1) {
    if (*c == '"' || *c == '\\') {
      out[used++] = '\\';
      out[used++] = *c;
    } else if ((unsigned char)*c < 0x20) {
      out[used++] = ' ';
    } else {
      out[used++] = *c;
    }
  }

  memcpy(out + used, "\"}}", 3);

  return pack(out, used + 3);
}

static JSValue native_call(JSContext *c, JSValueConst self, int argc, JSValueConst *argv) {
  size_t length = 0;
  const char *request = JS_ToCStringLen(c, &length, argv[0]);

  if (request == NULL) {
    return JS_EXCEPTION;
  }

  int64_t packed = brud_call((int32_t)(intptr_t)request, (int32_t)length);
  char *answer = (char *)(intptr_t)(packed >> 32);
  size_t answer_length = (size_t)(uint32_t)(packed & 0xffffffff);
  JSValue text = JS_NewStringLen(c, answer, answer_length);

  JS_FreeCString(c, request);
  free(answer);

  return text;
}

static int boot(void) {
  uint32_t length;
  JSValue result;

  memcpy(&length, (const void *)&script_slot[20], 4);

  rt = JS_NewRuntime();
  JS_SetMemoryLimit(rt, 32u * 1024 * 1024);
  JS_SetMaxStackSize(rt, 512 * 1024);
  ctx = JS_NewContext(rt);

  JSValue global = JS_GetGlobalObject(ctx);

  JS_SetPropertyStr(ctx, global, "__brud_native_call", JS_NewCFunction(ctx, native_call, "call", 1));

  result = JS_Eval(ctx, prelude_js, prelude_js_len, "brud-prelude.js", JS_EVAL_TYPE_GLOBAL);

  if (!JS_IsException(result)) {
    JS_FreeValue(ctx, result);
    result = JS_Eval(ctx, (const char *)&script_slot[24], length, "participant.js", JS_EVAL_TYPE_GLOBAL);
  }

  if (JS_IsException(result)) {
    JSValue exception = JS_GetException(ctx);

    boot_error = JS_ToCString(ctx, exception);
    JS_FreeValue(ctx, exception);
    JS_FreeValue(ctx, global);

    return 0;
  }

  JS_FreeValue(ctx, result);
  dispatch = JS_GetPropertyStr(ctx, global, "__brud_dispatch");
  JS_FreeValue(ctx, global);

  return 1;
}

__attribute__((export_name("brud_invoke")))
int64_t brud_invoke(int32_t ptr, int32_t len) {
  if (rt == NULL && !boot()) {
    return fail("GUEST_BOOT_FAILED", boot_error == NULL ? "the guest script failed to start" : boot_error);
  }

  if (boot_error != NULL) {
    return fail("GUEST_BOOT_FAILED", boot_error);
  }

  JSValue request = JS_NewStringLen(ctx, (const char *)(intptr_t)ptr, (size_t)len);
  JSValue answer = JS_Call(ctx, dispatch, JS_UNDEFINED, 1, &request);

  JS_FreeValue(ctx, request);
  free((void *)(intptr_t)ptr);

  if (JS_IsException(answer)) {
    JSValue exception = JS_GetException(ctx);
    const char *message = JS_ToCString(ctx, exception);
    int64_t reply = fail("GUEST_THROWN", message == NULL ? "the guest failed" : message);

    JS_FreeCString(ctx, message);
    JS_FreeValue(ctx, exception);

    return reply;
  }

  size_t length = 0;
  const char *text = JS_ToCStringLen(ctx, &length, answer);
  char *out = malloc(length + 1);

  memcpy(out, text, length);
  JS_FreeCString(ctx, text);
  JS_FreeValue(ctx, answer);

  return pack(out, length);
}
