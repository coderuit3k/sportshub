// Payment provider abstraction. MVP ships ONLY a simulated provider.
// It never moves real money and every record is labelled SIMULATED.
export interface PaymentProvider {
  name: string;
  simulated: boolean;
  charge(input: { amount: number; currency: string; reference: string }): Promise<{ status: string; providerRef: string }>;
}
export class SimulatedPaymentProvider implements PaymentProvider {
  name = "SIMULATED";
  simulated = true;
  async charge(input: { amount: number; currency: string; reference: string }) {
    return { status: "SIMULATED", providerRef: `sim_${input.reference}` };
  }
}
// Future: VietQR / MoMo providers implement this interface once credentials exist.
export function getPaymentProvider(): PaymentProvider {
  return new SimulatedPaymentProvider();
}
