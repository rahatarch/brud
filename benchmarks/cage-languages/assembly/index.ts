// AssemblyScript guest with the same workloads as handler.js.
let requestBuffer: ArrayBuffer = new ArrayBuffer(0);

export function brud_alloc(len: i32): i32 {
  requestBuffer = new ArrayBuffer(len);

  return changetype<i32>(requestBuffer);
}

function fib(n: i32): i32 {
  return n < 2 ? n : fib(n - 1) + fib(n - 2);
}

function lcg(iterations: i32): i32 {
  let x: i32 = 12345;
  let s: i32 = 0;

  for (let i: i32 = 0; i < iterations; i += 1) {
    x = x * 1664525 + 1013904223;
    s += i32((u32(x) >>> 16) & 7);
  }

  return s;
}

export function brud_invoke(ptr: i32, len: i32): i64 {
  const text = String.UTF8.decodeUnsafe(ptr, len);
  const at = text.indexOf('"method":"');
  const key = at < 0 ? '' : text.substr(at + 10, 4);
  let value: i32 = -1;

  if (key.startsWith('empt')) {
    value = 0;
  } else if (key.startsWith('tiny')) {
    value = fib(20);
  } else if (key.startsWith('h1m"')) {
    value = lcg(1000000);
  } else if (key.startsWith('h10m')) {
    value = lcg(10000000);
  }

  const bytes = String.UTF8.encode('{"ok":true,"value":' + value.toString() + '}');

  return (i64(changetype<i32>(bytes)) << 32) | i64(bytes.byteLength);
}
