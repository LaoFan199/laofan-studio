export const FRACTIONAL_EXECUTION_VERSION = 'fractional-v1';
export const MIN_ORDER_AMOUNT = 10;

const cents = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export function calculateFractionalOrder({
  amount,
  price,
  cash,
  currentPositionValue = 0,
  minimumCash = 200,
  maximumPosition = 200,
  minimumOrder = MIN_ORDER_AMOUNT
}) {
  const orderAmount = cents(amount);
  const numericPrice = Number(price);
  const availableCash = Math.max(0, cents(Number(cash) - Number(minimumCash)));
  const availablePosition = Math.max(0, cents(Number(maximumPosition) - Number(currentPositionValue)));
  const maximumAllowed = Math.max(0, Math.min(availableCash, availablePosition));
  const validInputs = Number.isFinite(orderAmount) && Number.isFinite(numericPrice) && numericPrice > 0;
  const quantity = validInputs && orderAmount > 0 ? orderAmount / numericPrice : 0;
  const valid = validInputs
    && orderAmount >= minimumOrder
    && orderAmount <= maximumAllowed + 0.001;

  return {
    amount: orderAmount,
    quantity,
    valid,
    maximumAllowed,
    availableCash,
    availablePosition,
    minimumOrder
  };
}
