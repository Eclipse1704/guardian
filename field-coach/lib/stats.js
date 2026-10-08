// Manager dashboard aggregates: what is really happening in the field.

const OBJECTION_LABELS = {
  price: 'מחיר',
  timing: 'תזמון',
  competitor: 'מתחרים',
  trust: 'אמון',
  need: 'צורך',
  decision_maker: 'מקבל החלטה',
  other: 'אחר',
};

const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

export function dashboard(db) {
  const done = db.meetings
    .filter((m) => m.status === 'done' && m.analysis)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;

  const allObjections = done.flatMap((m) => m.analysis.objections);
  const handledRate = allObjections.length
    ? Math.round((allObjections.filter((o) => o.handled === 'full').length / allObjections.length) * 100)
    : null;

  // Which objection types come up, and how often reps leave them unanswered.
  const byCategory = {};
  for (const o of allObjections) {
    const c = (byCategory[o.category || 'other'] ||= { category: o.category || 'other', total: 0, open: 0 });
    c.total++;
    if (o.handled !== 'full') c.open++;
  }
  const objectionTypes = Object.values(byCategory)
    .map((c) => ({ ...c, label: OBJECTION_LABELS[c.category] || c.category }))
    .sort((a, b) => b.total - a.total);

  // Team average per criterion (by criterion id, using the name from the latest meeting).
  const critMap = {};
  for (const m of done) {
    for (const c of m.analysis.criteria) {
      const e = (critMap[c.id] ||= { id: c.id, name: c.name, scores: [] });
      e.name = c.name;
      e.scores.push(c.score);
    }
  }
  const criteria = Object.values(critMap)
    .map((c) => ({ id: c.id, name: c.name, avg: Math.round((c.scores.reduce((a, b) => a + b, 0) / c.scores.length) * 10) / 10 }))
    .sort((a, b) => a.avg - b.avg);

  const reps = db.reps.map((rep) => {
    const mine = done.filter((m) => m.repId === rep.id);
    const crit = {};
    for (const m of mine) for (const c of m.analysis.criteria) (crit[c.name] ||= []).push(c.score);
    const critAvgs = Object.entries(crit).map(([name, s]) => ({ name, avg: s.reduce((a, b) => a + b, 0) / s.length }));
    critAvgs.sort((a, b) => a.avg - b.avg);
    const objs = mine.flatMap((m) => m.analysis.objections);
    return {
      id: rep.id,
      name: rep.name,
      meetings: mine.length,
      avgScore: avg(mine.map((m) => m.analysis.overall_score)),
      avgTalkRatio: avg(mine.map((m) => m.analysis.rep_talk_ratio)),
      avgDealProbability: avg(mine.map((m) => m.analysis.deal_probability)),
      objectionHandledRate: objs.length ? Math.round((objs.filter((o) => o.handled === 'full').length / objs.length) * 100) : null,
      trend: mine.slice(-8).map((m) => m.analysis.overall_score),
      weakest: critAvgs[0]?.name || null,
      strongest: critAvgs.at(-1)?.name || null,
    };
  });

  const recentOpen = done
    .slice(-20)
    .reverse()
    .flatMap((m) =>
      m.analysis.objections
        .filter((o) => o.handled === 'no')
        .map((o) => ({ meetingId: m.id, repId: m.repId, objection: o.objection, quote: o.quote, title: m.analysis.title })),
    )
    .slice(0, 6);

  return {
    company: db.settings.company,
    totals: {
      meetings: done.length,
      thisWeek: done.filter((m) => Date.parse(m.createdAt) >= weekAgo).length,
      avgScore: avg(done.map((m) => m.analysis.overall_score)),
      avgTalkRatio: avg(done.map((m) => m.analysis.rep_talk_ratio)),
      objectionHandledRate: handledRate,
      pipelineHot: done.filter((m) => m.analysis.deal_probability >= 60).length,
    },
    trend: done.slice(-12).map((m) => ({ date: m.createdAt, score: m.analysis.overall_score })),
    reps: reps.sort((a, b) => (b.avgScore ?? -1) - (a.avgScore ?? -1)),
    criteria,
    objectionTypes,
    recentOpen,
  };
}
