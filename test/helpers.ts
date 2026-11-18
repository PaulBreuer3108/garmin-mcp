export function fakeJwt(expSeconds: number): string {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b({ alg: "none" })}.${b({ exp: expSeconds })}.sig`;
}
