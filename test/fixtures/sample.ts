/**
 * Represents a loan position in the securities lending system.
 */
export interface ILoanPosition {
  loanId: string;
  borrower: string;
  lender: string;
  quantity: number;
  collateralValue: number;
  status: "open" | "closed" | "pending";
}

/**
 * Calculates the total collateral value for a set of positions.
 */
export function calculateCollateral(positions: ILoanPosition[]): number {
  return positions.reduce((sum, p) => sum + p.collateralValue, 0);
}

export enum LoanStatus {
  Open = "open",
  Closed = "closed",
  Pending = "pending",
}
