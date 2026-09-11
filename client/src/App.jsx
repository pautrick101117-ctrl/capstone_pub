import { Navigate, RouterProvider, createBrowserRouter, createRoutesFromElements, Route } from "react-router-dom";
import LandingPageLayout from "./components/layouts/LandingPageLayout";
import Home from "./pages/client/Home";
import FundTransparency from "./pages/client/FundTransparency";
import Officials from "./pages/client/Officials";
import Login from "./pages/client/Login";
import HelpCenter from "./pages/client/HelpCenter";
import TermsOfUse from "./pages/client/TermsOfUse";
import PrivacyPolicy from "./pages/client/PrivacyPolicy";
import VotingResult from "./pages/client/VotingResult";
import ProjectUpdatesPage from "./pages/client/ProjectUpdatesPage";
import PublicFeedPage from "./pages/client/PublicFeedPage";
import NewsArticlePage from "./pages/client/NewsArticlePage";
import CalendarPage from "./pages/client/CalendarPage";
import VotingCenter from "./pages/client/VotingCenter";
import UserDashboard from "./pages/client/UserDashboard";
import UserPortalLayout from "./components/layouts/UserPortalLayout";
import { ProtectedRoute } from "./components/routes/ProtectedRoute";
import RequestsPage from "./pages/client/RequestsPage";
import SuggestionsPage from "./pages/client/SuggestionsPage";
import ChangePassword from "./pages/client/ChangePassword";
import SettingsPage from "./pages/client/SettingsPage";
import Complaints from "./pages/client/Complaints";
import BorrowingPage from "./pages/client/BorrowingPage";
import AdminPageLayout from "./components/layouts/AdminPageLayout";
import AdminDashboard from "./pages/admin/AdminDashboard";
import Admin_Residents from "./pages/admin/Admin_Residents";
import Admin_Officials from "./pages/admin/Admin_Officials";
import AdminLogin from "./pages/admin/AdminLogin";
import AdminRequests from "./pages/admin/AdminRequests";
import AdminContentPage from "./pages/admin/AdminContentPage";
import AdminFunds from "./pages/admin/AdminFunds";
import AdminEvents from "./pages/admin/AdminEvents";
import Admin_VotingResult from "./pages/admin/Admin_VotingResult";
import Admin_Census from "./pages/admin/Admin_Census";
import Admin_UserMaintenance from "./pages/admin/Admin_UserMaintenance";
import Admin_Complaints from "./pages/admin/Admin_Complaints";
import Admin_Settings from "./pages/admin/Admin_Settings";
import Admin_Borrowing from "./pages/admin/Admin_Borrowing";
import AdminBroadcast from "./pages/admin/AdminBroadcast";
import AdminAuditLogs from "./pages/admin/AdminAuditLogs";
import AdminProjectSuggestions from "./pages/admin/AdminProjectSuggestions";
import AdminProjects from "./pages/admin/AdminProjects";

const router = createBrowserRouter(
  createRoutesFromElements(
    <>
      <Route path="/" element={<LandingPageLayout />}>
        <Route index element={<Home />} />
        <Route path="news" element={<PublicFeedPage type="news" />} />
        <Route path="news/:id" element={<NewsArticlePage />} />
        <Route path="announcements" element={<PublicFeedPage type="announcement" />} />
        <Route path="fund_transparency" element={<FundTransparency />} />
        <Route path="officials" element={<Officials />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="help-center" element={<HelpCenter />} />
        <Route path="terms-of-use" element={<TermsOfUse />} />
        <Route path="privacy-policy" element={<PrivacyPolicy />} />
        <Route path="voting-result" element={<VotingResult />} />
        <Route path="project-updates" element={<ProjectUpdatesPage />} />
        <Route path="project-updates/:projectId" element={<ProjectUpdatesPage />} />
        <Route path="login" element={<Login />} />
      </Route>

      <Route path="admin/login" element={<AdminLogin />} />

      <Route element={<ProtectedRoute redirectTo="/login" />}>
        <Route path="change-password" element={<ChangePassword />} />
      </Route>

      <Route element={<ProtectedRoute roles={["resident"]} redirectTo="/login" />}>
        <Route path="/" element={<UserPortalLayout />}>
          <Route path="portal" element={<UserDashboard />} />
          <Route path="portal/requests" element={<RequestsPage />} />
          <Route path="portal/voting" element={<VotingCenter />} />
          <Route path="portal/calendar" element={<CalendarPage />} />
          <Route path="portal/suggestions" element={<SuggestionsPage />} />
          <Route path="portal/results" element={<Navigate to="/portal/voting-result" replace />} />
          <Route path="portal/voting-result" element={<VotingResult />} />
          <Route path="portal/complaints" element={<Complaints />} />
          <Route path="portal/borrowing" element={<BorrowingPage />} />
          <Route path="portal/settings" element={<SettingsPage />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute roles={["admin"]} redirectTo="/admin/login" />}>
        <Route path="admin" element={<AdminPageLayout />}>
          <Route index element={<AdminDashboard />} />
          <Route path="residents" element={<Admin_Residents />} />
          <Route path="requests" element={<AdminRequests />} />
          <Route path="officials" element={<Admin_Officials />} />
          <Route path="news" element={<AdminContentPage type="news" />} />
          <Route path="announcements" element={<AdminContentPage type="announcement" />} />
          <Route path="funds" element={<AdminFunds />} />
          <Route path="events" element={<AdminEvents />} />
          <Route path="project-suggestions" element={<AdminProjectSuggestions />} />
          <Route path="voting" element={<Admin_VotingResult />} />
          <Route path="projects" element={<AdminProjects />} />
          <Route path="census" element={<Admin_Census />} />
          <Route path="complaints" element={<Admin_Complaints />} />
          <Route path="borrowing" element={<Admin_Borrowing />} />
          <Route path="broadcasts" element={<AdminBroadcast />} />
          <Route path="settings" element={<Admin_Settings />} />
          <Route element={<ProtectedRoute roles={["super_admin"]} redirectTo="/admin" />}>
            <Route path="user-maintenance" element={<Admin_UserMaintenance />} />
            <Route path="audit-logs" element={<AdminAuditLogs />} />
          </Route>
        </Route>
      </Route>
    </>
  )
);

const App = () => <RouterProvider router={router} />;

export default App;

