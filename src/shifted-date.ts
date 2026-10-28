export function shiftedDate(start: number): DateConstructor {
  const RealDate = Date;
  const offset = start - RealDate.now();
  const now = (): number => RealDate.now() + offset;
  return new Proxy(RealDate, {
    apply: () => new RealDate(now()).toString(),
    construct: (target, args, newTarget) =>
      Reflect.construct(target, args.length === 0 ? [now()] : args, newTarget),
    get: (target, key, receiver) => (key === "now" ? now : Reflect.get(target, key, receiver)),
  });
}
