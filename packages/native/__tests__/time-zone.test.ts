it("runs eleven hours behind UTC, so a UTC day cannot pass for a local one", () => {
  expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("Pacific/Pago_Pago");
  expect(new Date("2026-07-01T05:00:00.000Z").getDate()).toBe(30);
});
