import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import DocumentRequestDetail from "../../components/DocumentRequestDetail";

export default function DocumentRequestPage() {
  const { id } = useParams();
  return <main className="mx-auto max-w-6xl space-y-5 pb-12">
    <Link to="/admin/requests" className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 py-2 font-semibold text-green-800 hover:bg-green-50 focus-visible:outline-2 focus-visible:outline-green-700"><ArrowLeft className="h-5 w-5" /> Back to document requests</Link>
    <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm sm:p-8">
      <DocumentRequestDetail id={id} />
    </div>
  </main>;
}
