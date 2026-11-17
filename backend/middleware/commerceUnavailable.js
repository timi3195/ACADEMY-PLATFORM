const COMMERCE_UNAVAILABLE = Object.freeze({
  success: false,
  code: "COMMERCE_UNAVAILABLE",
  message: "Payments and marketplace commerce are unavailable in this release."
});

const sendCommerceUnavailable = (_req, res) =>
  res.status(410).json(COMMERCE_UNAVAILABLE);

sendCommerceUnavailable.send = (res) =>
  res.status(410).json(COMMERCE_UNAVAILABLE);

module.exports = sendCommerceUnavailable;
