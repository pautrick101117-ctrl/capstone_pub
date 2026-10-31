import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../context/auth";

const hasAllowedRole = (role, roles) => roles.includes(role) || (role === "super_admin" && roles.includes("admin"));

export const ProtectedRoute = ({ roles, redirectTo = "/login" }) => {
  const { isAuthenticated, user, isPasswordChangeRequired } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to={redirectTo} replace />;
  }

  if (roles && !hasAllowedRole(user?.role, roles)) {
    return <Navigate to={redirectTo} replace />;
  }

  if (isPasswordChangeRequired && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }

  return <Outlet />;
};


