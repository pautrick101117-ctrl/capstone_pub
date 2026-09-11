import { ArrowLeft, Newspaper } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, useParams } from "react-router-dom";
import { api } from "../../lib/api";
import { Card, ErrorState, LoadingState } from "../../components/ui";
import { formatDate } from "../../lib/format";

const NewsArticlePage = () => {
  const { id } = useParams();
  const [article, setArticle] = useState(null);
  const [related, setRelated] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true); setError("");
    try {
      const data = await api(`/public/news/${id}`);
      setArticle(data.article || null); setRelated(data.related || []);
    } catch (err) { setError(err.message || "Unable to load this news article."); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [id]);

  if (loading) return <section className="section-shell py-10 sm:py-14"><LoadingState rows={6} /></section>;
  if (error || !article) return <section className="section-shell py-10 sm:py-14"><ErrorState title="News article unavailable" description={error || "This article could not be found."} onRetry={load} /></section>;

  return <section className="section-shell py-10 sm:py-14">
    <NavLink to="/news" className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--brand-600)] hover:underline"><ArrowLeft className="h-4 w-4" /> Back to News</NavLink>
    <article className="mx-auto mt-8 max-w-4xl">
      <p className="text-xs font-bold uppercase tracking-[0.28em] text-[var(--brand-500)]">Community News</p>
      <h1 className="mt-3 text-4xl font-black tracking-tight text-[var(--brand-900)] sm:text-5xl">{article.title}</h1>
      <p className="mt-4 text-sm font-semibold text-stone-500">{formatDate(article.createdAt)}</p>
      {article.imageUrl ? <img src={article.imageUrl} alt={article.title} className="mt-8 max-h-[32rem] w-full rounded-[2rem] object-cover shadow-sm" /> : null}
      <div className="mt-8 whitespace-pre-wrap text-base leading-8 text-stone-700">{article.body}</div>
    </article>

    {related.length ? <div className="mt-16 border-t border-stone-200 pt-10"><h2 className="text-2xl font-black text-[var(--brand-900)]">Related News</h2><div className="mt-6 grid gap-5 md:grid-cols-3">{related.map((item) => <NavLink key={item.id} to={`/news/${item.id}`}><Card className="h-full overflow-hidden p-0 hover:border-[var(--brand-200)] hover:shadow-md">{item.imageUrl ? <img src={item.imageUrl} alt={item.title} className="h-40 w-full object-cover" /> : <div className="flex h-40 items-center justify-center bg-[var(--brand-50)] text-[var(--brand-600)]"><Newspaper className="h-8 w-8" /></div>}<div className="p-5"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-500)]">{formatDate(item.createdAt)}</p><h3 className="mt-2 font-bold text-[var(--brand-900)]">{item.title}</h3><p className="mt-2 line-clamp-3 text-sm leading-6 text-stone-500">{item.body}</p></div></Card></NavLink>)}</div></div> : null}
  </section>;
};

export default NewsArticlePage;
