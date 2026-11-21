// The same workloads the AssemblyScript guest implements. The cage calls
// handler(request) with the parsed brud_invoke request and wraps the result.
function fib(n) {
  return n < 2 ? n : fib(n - 1) + fib(n - 2);
}

function lcg(iterations) {
  let x = 12345;
  let s = 0;

  for (let i = 0; i < iterations; i += 1) {
    x = (Math.imul(x, 1664525) + 1013904223) | 0;
    s = (s + ((x >>> 16) & 7)) | 0;
  }

  return s;
}

globalThis.handler = function handler(request) {
  switch (request.method) {
    case 'empty': return 0;
    case 'tiny': return fib(20);
    case 'h1m': return lcg(1000000);
    case 'h10m': return lcg(10000000);
    default: return -1;
  }
};
