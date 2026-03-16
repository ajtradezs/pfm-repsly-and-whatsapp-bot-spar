// Builds report objects and formats email/WhatsApp output

// Determine rep status based on check-ins
function getStatus(checkIns) {
  if (checkIns >= 3) return 'ACTIVE';
  if (checkIns >= 1) return 'PARTIAL';
  return 'INACTIVE';
}

function getStatusColor(status) {
  switch (status) {
    case 'ACTIVE':
      return '#27ae60';
    case 'PARTIAL':
      return '#f39c12';
    case 'INACTIVE':
      return '#e74c3c';
    default:
      return '#95a5a6';
  }
}

function getStatusBg(status) {
  switch (status) {
    case 'ACTIVE':
      return '#eafaf1';
    case 'PARTIAL':
      return '#fef9e7';
    case 'INACTIVE':
      return '#fdedec';
    default:
      return '#f8f9fa';
  }
}

// Merge Repsly data with WhatsApp buffer data into unified per-rep report
// repslyData: array of { repName, repEmail, checkIns, photos, formsCompleted, formNames, kmTravelled, notes, visitDetails }
// waData: Map<repName, message[]>
function buildTeamReport(teamName, repslyData, waData) {
  const repMap = {};

  // Seed from Repsly data
  for (const rep of repslyData) {
    const key = rep.repEmail || rep.repName;
    repMap[key] = {
      repName: rep.repName,
      repEmail: rep.repEmail,
      checkIns: rep.checkIns || 0,
      photos: rep.photos || 0,
      formsCompleted: rep.formsCompleted || 0,
      formNames: rep.formNames || [],
      kmTravelled: rep.kmTravelled || 0,
      notes: rep.notes || [],
      visitDetails: rep.visitDetails || [],
      waMessages: 0,
      waPhotos: 0,
      waActivity: [],
      lastWaTime: null,
      storesVisited: new Set((rep.visitDetails || []).map((v) => v.clientName).filter(Boolean)).size
    };
  }

  // Merge WhatsApp data
  for (const [waRepName, messages] of waData.entries()) {
    // Try to match by name (case-insensitive partial match)
    let matchKey = null;
    for (const key of Object.keys(repMap)) {
      const repslyName = repMap[key].repName.toLowerCase();
      const waName = waRepName.toLowerCase();
      if (repslyName.includes(waName) || waName.includes(repslyName)) {
        matchKey = key;
        break;
      }
    }

    // If no match, create a WA-only entry
    if (!matchKey) {
      matchKey = waRepName;
      repMap[matchKey] = {
        repName: waRepName,
        repEmail: '',
        checkIns: 0,
        photos: 0,
        formsCompleted: 0,
        formNames: [],
        kmTravelled: 0,
        notes: [],
        visitDetails: [],
        waMessages: 0,
        waPhotos: 0,
        waActivity: [],
        lastWaTime: null,
        storesVisited: 0
      };
    }

    const rep = repMap[matchKey];
    rep.waMessages += messages.length;
    rep.waActivity = messages.map((m) => m.parsed.summary).filter(Boolean);

    for (const msg of messages) {
      rep.waPhotos += msg.mediaCount || 0;
      if (!rep.lastWaTime || new Date(msg.time) > new Date(rep.lastWaTime)) {
        rep.lastWaTime = msg.time;
      }
    }
  }

  // Add status to each rep
  const reps = Object.values(repMap).map((rep) => ({
    ...rep,
    status: getStatus(rep.checkIns),
    notes: Array.isArray(rep.notes) ? rep.notes : []
  }));

  // Sort: ACTIVE first, then PARTIAL, then INACTIVE, then by name
  const order = { ACTIVE: 0, PARTIAL: 1, INACTIVE: 2 };
  reps.sort((a, b) => order[a.status] - order[b.status] || a.repName.localeCompare(b.repName));

  // Compute summary stats
  const totalActive = reps.filter((r) => r.status === 'ACTIVE').length;
  const totalPartial = reps.filter((r) => r.status === 'PARTIAL').length;
  const totalInactive = reps.filter((r) => r.status === 'INACTIVE').length;
  const totalCheckIns = reps.reduce((s, r) => s + r.checkIns, 0);
  const totalPhotos = reps.reduce((s, r) => s + r.photos + r.waPhotos, 0);
  const totalForms = reps.reduce((s, r) => s + r.formsCompleted, 0);
  const totalKm = Math.round(reps.reduce((s, r) => s + r.kmTravelled, 0) * 10) / 10;

  return {
    teamName,
    reps,
    summary: {
      totalReps: reps.length,
      totalActive,
      totalPartial,
      totalInactive,
      totalCheckIns,
      totalPhotos,
      totalForms,
      totalKm
    }
  };
}

// Format a full HTML email report
function formatEmailHTML(teamName, reportData, date, sheetUrl) {
  const { reps, summary } = reportData;

  const repRows = reps
    .map((rep) => {
      const status = rep.status;
      const bg = getStatusBg(status);
      const color = getStatusColor(status);
      const notesStr = rep.notes.slice(0, 3).join('<br>') || '—';
      const waStr = rep.waActivity.slice(0, 2).join('<br>') || `${rep.waMessages} messages`;
      const lastWa = rep.lastWaTime
        ? new Date(rep.lastWaTime).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
        : '—';

      return `
        <tr style="background:${bg}">
          <td style="padding:8px 12px;font-weight:bold">${rep.repName}</td>
          <td style="padding:8px 12px;text-align:center">${rep.checkIns}</td>
          <td style="padding:8px 12px;text-align:center">${rep.storesVisited || rep.checkIns}</td>
          <td style="padding:8px 12px;text-align:center">${rep.photos + rep.waPhotos}</td>
          <td style="padding:8px 12px;text-align:center">${rep.formsCompleted}</td>
          <td style="padding:8px 12px;text-align:center">${rep.kmTravelled} km</td>
          <td style="padding:8px 12px;font-size:12px">${notesStr}</td>
          <td style="padding:8px 12px;font-size:12px">${waStr}</td>
          <td style="padding:8px 12px;text-align:center">
            <span style="background:${color};color:#fff;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:bold">${status}</span>
          </td>
        </tr>`;
    })
    .join('');

  const sheetLink = sheetUrl
    ? `<p style="text-align:center;margin-top:24px"><a href="${sheetUrl}" style="background:#2c3e50;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:bold">View Full Report in Google Sheets</a></p>`
    : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;color:#2c3e50;max-width:900px;margin:0 auto;padding:20px">

  <div style="background:#2c3e50;color:#fff;padding:20px 30px;border-radius:8px 8px 0 0">
    <h1 style="margin:0;font-size:22px">${teamName} — Daily Activity Report</h1>
    <p style="margin:4px 0 0;opacity:0.8">${date}</p>
  </div>

  <!-- Summary Bar -->
  <div style="display:flex;gap:0;border:1px solid #ddd;border-top:none">
    <div style="flex:1;padding:16px;text-align:center;border-right:1px solid #ddd;background:#eafaf1">
      <div style="font-size:28px;font-weight:bold;color:#27ae60">${summary.totalActive}</div>
      <div style="font-size:12px;color:#555">ACTIVE</div>
    </div>
    <div style="flex:1;padding:16px;text-align:center;border-right:1px solid #ddd;background:#fef9e7">
      <div style="font-size:28px;font-weight:bold;color:#f39c12">${summary.totalPartial}</div>
      <div style="font-size:12px;color:#555">PARTIAL</div>
    </div>
    <div style="flex:1;padding:16px;text-align:center;border-right:1px solid #ddd;background:#fdedec">
      <div style="font-size:28px;font-weight:bold;color:#e74c3c">${summary.totalInactive}</div>
      <div style="font-size:12px;color:#555">INACTIVE</div>
    </div>
    <div style="flex:1;padding:16px;text-align:center;border-right:1px solid #ddd">
      <div style="font-size:28px;font-weight:bold">${summary.totalCheckIns}</div>
      <div style="font-size:12px;color:#555">CHECK-INS</div>
    </div>
    <div style="flex:1;padding:16px;text-align:center;border-right:1px solid #ddd">
      <div style="font-size:28px;font-weight:bold">${summary.totalPhotos}</div>
      <div style="font-size:12px;color:#555">PHOTOS</div>
    </div>
    <div style="flex:1;padding:16px;text-align:center;border-right:1px solid #ddd">
      <div style="font-size:28px;font-weight:bold">${summary.totalForms}</div>
      <div style="font-size:12px;color:#555">FORMS</div>
    </div>
    <div style="flex:1;padding:16px;text-align:center">
      <div style="font-size:28px;font-weight:bold">${summary.totalKm}</div>
      <div style="font-size:12px;color:#555">KM TOTAL</div>
    </div>
  </div>

  <!-- Rep Table -->
  <table style="width:100%;border-collapse:collapse;margin-top:20px;border:1px solid #ddd">
    <thead>
      <tr style="background:#34495e;color:#fff">
        <th style="padding:10px 12px;text-align:left">Rep Name</th>
        <th style="padding:10px 12px;text-align:center">Check-ins</th>
        <th style="padding:10px 12px;text-align:center">Stores</th>
        <th style="padding:10px 12px;text-align:center">Photos</th>
        <th style="padding:10px 12px;text-align:center">Forms</th>
        <th style="padding:10px 12px;text-align:center">KM</th>
        <th style="padding:10px 12px;text-align:left">Notes</th>
        <th style="padding:10px 12px;text-align:left">WA Activity</th>
        <th style="padding:10px 12px;text-align:center">Status</th>
      </tr>
    </thead>
    <tbody>
      ${repRows}
    </tbody>
  </table>

  ${sheetLink}

  <p style="margin-top:24px;font-size:11px;color:#999;text-align:center">
    Generated by Rep Activity Agent &bull; ${new Date().toISOString()}
  </p>
</body>
</html>`;
}

// Format a short WhatsApp text summary
function formatWASummary(teamName, reportData, date, sheetUrl) {
  const { reps, summary } = reportData;

  const activeReps = reps.filter((r) => r.status === 'ACTIVE');
  const partialReps = reps.filter((r) => r.status === 'PARTIAL');
  const inactiveReps = reps.filter((r) => r.status === 'INACTIVE');

  const activeLines = activeReps
    .map((r) => `  ${r.repName}: ${r.checkIns} check-ins, ${r.formsCompleted} forms, ${r.kmTravelled}km`)
    .join('\n');

  const partialLines = partialReps
    .map((r) => `  ${r.repName}: ${r.checkIns} check-in(s)`)
    .join('\n');

  const inactiveNames = inactiveReps.map((r) => r.repName).join(', ') || 'None';

  const sheetLine = sheetUrl ? `\nFull report: ${sheetUrl}` : '';

  return (
    `*${teamName} — ${date}*\n\n` +
    `*ACTIVE (${summary.totalActive} reps):*\n${activeLines || '  None'}\n\n` +
    (partialReps.length > 0 ? `*PARTIAL (${summary.totalPartial}):*\n${partialLines}\n\n` : '') +
    `*INACTIVE:* ${inactiveNames}\n\n` +
    `*Summary:* ${summary.totalCheckIns} check-ins | ${summary.totalPhotos} photos | ${summary.totalForms} forms | ${summary.totalKm}km` +
    sheetLine
  );
}

module.exports = {
  buildTeamReport,
  formatEmailHTML,
  formatWASummary
};
