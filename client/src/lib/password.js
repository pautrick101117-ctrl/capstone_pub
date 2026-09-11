export const PASSWORD_POLICY_MESSAGE = "Use at least 8 characters with at least 1 uppercase letter and 1 number.";

export const passwordPolicyChecks = (password = "") => ({
  length: `${password}`.length >= 8,
  uppercase: /[A-Z]/.test(`${password}`),
  number: /[0-9]/.test(`${password}`),
});

export const isStrongPassword = (password = "") => {
  const checks = passwordPolicyChecks(password);
  return checks.length && checks.uppercase && checks.number && `${password}`.length <= 128;
};

