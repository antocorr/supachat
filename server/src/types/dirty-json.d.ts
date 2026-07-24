declare module 'dirty-json' {
  export function parse(input: string): unknown;
  const dirtyJson: { parse: typeof parse };
  export default dirtyJson;
}
