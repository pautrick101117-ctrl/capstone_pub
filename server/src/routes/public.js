import express from "express";
import { requireSupabase } from "../lib/supabase.js";

const router = express.Router();

const getPagination = (req) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(12, Math.max(1, Number(req.query.limit || 6)));
  const from = (page - 1) * limit;
  const to = from + limit - 1;
  return { page, limit, from, to };
};

const mapAnnouncement = (item) => ({
  id: item.id,
  title: item.title,
  body: item.body,
  imageUrl: item.image_url,
  type: item.type,
  createdAt: item.created_at,
});

router.get("/landing", async (_req, res, next) => {
  try {
    const db = requireSupabase();
    const [
      residents,
      completedProjects,
      activeOfficials,
      totalFundsSpent,
      fundSources,
      upcomingEvents,
      news,
      announcements,
      liveElection,
      contentRows,
    ] = await Promise.all([
      db.from("users").select("*", { count: "exact", head: true }).eq("role", "resident").eq("is_active", true),
      db.from("fund_projects").select("*", { count: "exact", head: true }).eq("status", "completed"),
      db.from("officials").select("*", { count: "exact", head: true }).eq("is_active", true),
      db.from("fund_projects").select("amount"),
      db.from("fund_sources").select("allocated_amount"),
      db.from("events").select("*").gte("date", new Date().toISOString().slice(0, 10)).order("date").order("time").limit(3),
      db.from("announcements").select("*").eq("type", "news").order("created_at", { ascending: false }).limit(3),
      db.from("announcements").select("*").eq("type", "announcement").order("created_at", { ascending: false }).limit(3),
      db.from("elections").select("id, title, description, ends_at, image_url").eq("status", "live").lte("starts_at", new Date().toISOString()).gt("ends_at", new Date().toISOString()).order("starts_at", { ascending: false }).limit(1).maybeSingle(),
      db.from("landing_content").select("*").order("key_name"),
    ]);

    const spent = (totalFundsSpent.data || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const totalFunds = (fundSources.data || []).reduce((sum, row) => sum + Number(row.allocated_amount || 0), 0);

    res.json({
      hero: Object.fromEntries((contentRows.data || []).map((item) => [item.key_name, item.value])),
      statistics: {
        totalRegisteredResidents: residents.count || 0,
        completedProjects: completedProjects.count || 0,
        activeOfficials: activeOfficials.count || 0,
        totalFundsSpent: spent,
      },
      fundSummary: {
        total: totalFunds,
        spent,
        remaining: Math.max(totalFunds - spent, 0),
      },
      upcomingEvents: (upcomingEvents.data || []).map((item) => ({
        id: item.id,
        title: item.title,
        date: item.date,
        time: item.time,
        location: item.location,
        description: item.description,
        type: item.type,
      })),
      news: (news.data || []).map(mapAnnouncement),
      announcements: (announcements.data || []).map(mapAnnouncement),
      liveElection: liveElection.data
        ? {
            id: liveElection.data.id,
            title: liveElection.data.title,
            description: liveElection.data.description,
            endsAt: liveElection.data.ends_at,
            imageUrl: liveElection.data.image_url,
          }
        : null,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/announcements", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const type = req.query.type === "news" ? "news" : "announcement";
    const { page, limit, from, to } = getPagination(req);
    const { data, error, count } = await db
      .from("announcements")
      .select("*", { count: "exact" })
      .eq("type", type)
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) throw error;

    res.json({
      items: (data || []).map(mapAnnouncement),
      pagination: { page, limit, total: count || 0 },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/funds", async (_req, res, next) => {
  try {
    const db = requireSupabase();
    const [projects, sources] = await Promise.all([
      db.from("fund_projects").select("*").order("date", { ascending: false }),
      db.from("fund_sources").select("*").order("created_at", { ascending: false }),
    ]);
    if (projects.error) throw projects.error;
    if (sources.error) throw sources.error;

    res.json({
      sources: sources.data || [],
      projects: (projects.data || []).map((item) => ({
        id: item.id,
        name: item.name,
        date: item.date,
        amount: Number(item.amount || 0),
        description: item.description,
        receiptUrl: item.receipt_url,
        term: item.term,
        status: item.status,
        createdAt: item.created_at,
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/events", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const { page, limit, from, to } = getPagination(req);
    let query = db.from("events").select("*", { count: "exact" });
    if (req.query.upcomingOnly === "true") {
      query = query.gte("date", new Date().toISOString().slice(0, 10));
    }
    const { data, error, count } = await query.order("date").order("time").range(from, to);
    if (error) throw error;

    res.json({
      items: data || [],
      pagination: { page, limit, total: count || 0 },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/officials", async (_req, res, next) => {
  try {
    const db = requireSupabase();
    const { data, error } = await db
      .from("officials")
      .select("*")
      .eq("is_active", true)
      .order("created_at");
    if (error) throw error;
    res.json({ officials: data || [] });
  } catch (error) {
    next(error);
  }
});

export default router;
