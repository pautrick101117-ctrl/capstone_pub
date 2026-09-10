import { randomInt } from "node:crypto";

export const createCode = () => `${randomInt(100000, 1000000)}`;

export const hashPassword = async (bcrypt, password) => bcrypt.hash(password, 12);

export const comparePassword = async (bcrypt, password, hash) => bcrypt.compare(password, hash);

export const PASSWORD_POLICY_MESSAGE = "Password must be at least 8 characters and include at least one uppercase letter and one number.";

export const isStrongPassword = (password = "") => {
  const value = `${password}`;
  return value.length >= 8 && value.length <= 128 && /[A-Z]/.test(value) && /[0-9]/.test(value);
};

export const ensureStrongPassword = (password = "") => {
  if (!isStrongPassword(password)) {
    throw Object.assign(new Error(PASSWORD_POLICY_MESSAGE), { status: 400 });
  }
  return true;
};

const securePick = (characters) => characters[randomInt(0, characters.length)];

export const createTemporaryPassword = (length = 12) => {
  const targetLength = Math.max(8, Number(length) || 12);
  const uppercase = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lowercase = "abcdefghijkmnopqrstuvwxyz";
  const numbers = "23456789";
  const symbols = "!@#$";
  const alphabet = `${uppercase}${lowercase}${numbers}${symbols}`;

  const characters = [securePick(uppercase), securePick(numbers), securePick(lowercase), securePick(symbols)];
  while (characters.length < targetLength) characters.push(securePick(alphabet));

  // Fisher-Yates shuffle using crypto-backed randomInt so required characters are not predictable by position.
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index + 1);
    [characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]];
  }

  return characters.join("");
};

export const normalizePhoneNumber = (phone = "") =>
  `${phone}`.replace(/[^\d]/g, "").replace(/^63/, "0").replace(/^9/, "09");

export const buildUsername = ({ fullName = "", firstName = "", lastName = "", suffix = "" }) => {
  const source = fullName || `${firstName} ${lastName}`;
  const cleaned = source
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const [first = "resident", ...rest] = cleaned;
  const last = rest[rest.length - 1] || "user";
  const base = `${first}.${last}`.replace(/\.+/g, ".");
  return suffix ? `${base}.${suffix}` : base;
};

export const calculateAge = (birthdate) => {
  if (!birthdate) return 0;
  const today = new Date();
  const birth = new Date(birthdate);
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age;
};

export const ensureAdult = (birthdate) => {
  if (!birthdate) {
    throw Object.assign(new Error("Birthdate is required."), { status: 400 });
  }

  if (calculateAge(birthdate) < 18) {
    throw Object.assign(new Error("Resident must be at least 18 years old."), { status: 400 });
  }
};

export const normalizeRole = (role) => {
  const value = `${role || ""}`.trim().toLowerCase();

  if (["super_admin", "super-admin", "superadmin"].includes(value)) {
    return "super_admin";
  }

  if (["admin", "staff"].includes(value)) {
    return "admin";
  }

  return "resident";
};

export const roleMatches = (role, allowedRoles = []) => {
  const normalizedRole = normalizeRole(role);
  const normalizedAllowedRoles = allowedRoles.map((allowedRole) => normalizeRole(allowedRole));

  return normalizedAllowedRoles.includes(normalizedRole) || (normalizedRole === "super_admin" && normalizedAllowedRoles.includes("admin"));
};

export const sanitizeUser = (user) => ({
  id: user.id,
  email: user.email,
  firstName: user.first_name,
  middleName: user.middle_name,
  lastName: user.last_name,
  fullName: user.full_name || [user.first_name, user.middle_name, user.last_name].filter(Boolean).join(" "),
  address: user.address,
  purok: user.purok,
  birthdate: user.birthdate,
  username: user.username,
  contactNumber: user.contact_number,
  role: normalizeRole(user.role),
  status: user.status,
  isActive: Boolean(user.is_active),
  mustChangePassword: Boolean(user.must_change_password),
  emailVerified: user.email_verified,
  emailVerifiedAt: user.email_verified_at,
  verificationProvider: user.verification_provider,
  hasVoted: Boolean(user.has_voted),
  createdAt: user.created_at,
});
