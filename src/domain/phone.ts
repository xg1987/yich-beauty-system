export const MOBILE_PHONE_MAX_LENGTH = 11;
export const MOBILE_PHONE_ERROR_MESSAGE = "手机号必须为 11 位数字";

export function mobilePhoneDigits(value: string | undefined) {
  return (value ?? "").replace(/\D/g, "");
}

export function normalizeMobilePhoneDraft(value: string | undefined) {
  return mobilePhoneDigits(value).slice(0, MOBILE_PHONE_MAX_LENGTH);
}

export function normalizeMobilePhoneForSubmit(value: string | undefined) {
  const digits = mobilePhoneDigits(value);
  return digits.length === MOBILE_PHONE_MAX_LENGTH ? digits : "";
}

export function isCompleteMobilePhone(value: string | undefined) {
  return Boolean(normalizeMobilePhoneForSubmit(value));
}

export function requireMobilePhone(value: string | undefined, message = MOBILE_PHONE_ERROR_MESSAGE) {
  const phone = normalizeMobilePhoneForSubmit(value);
  if (!phone) throw new Error(message);
  return phone;
}

export function optionalMobilePhone(value: string | undefined, message = MOBILE_PHONE_ERROR_MESSAGE) {
  if (!value?.trim()) return "";
  return requireMobilePhone(value, message);
}
