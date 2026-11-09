/** Định dạng mã chia sẻ (32 ký tự base64url do server sinh). Dùng cả ở middleware (Edge) nên không import gì của server. */
export const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;
