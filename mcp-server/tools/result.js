export function errorResult(err) {
  return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
}
