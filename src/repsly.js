// READ ONLY — only GET /export/ endpoints. Never write to Repsly.

require('dotenv').config();
const axios = require('axios');

const BASE_URL = process.env.REPSLY_BASE_URL || 'https://api.repsly.com/v3';
const USERNAME = process.env.REPSLY_USERNAME;
const PASSWORD = process.env.REPSLY_PASSWORD;

function getAuthHeader() {
  const token = Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');
  return { Authorization: `Basic ${token}` };
}

// Haversine formula — returns distance in km between two lat/lon points
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// GET /v3/export/representatives
async function getRepresentatives() {
  try {
    const res = await axios.get(`${BASE_URL}/export/representatives`, {
      headers: getAuthHeader()
    });
    const data = res.data;
    const list = Array.isArray(data) ? data : data.Data || data.Representatives || [];
    return list.map((r) => ({
      name: r.Name || r.RepresentativeName || '',
      email: r.Email || r.RepresentativeEmail || '',
      code: r.Code || r.RepresentativeCode || '',
      active: r.Active !== undefined ? r.Active : true,
      attributes: r.Attributes || {}
    }));
  } catch (err) {
    console.error('[Repsly] getRepresentatives error:', err.message);
    return [];
  }
}

// GET /v3/export/visits/{timestamp} with pagination
// dateStr format: YYYY-MM-DD
async function getVisitsForDate(dateStr) {
  const results = [];
  let timestamp = 0;

  try {
    while (true) {
      const url = `${BASE_URL}/export/visits/${timestamp}`;
      const res = await axios.get(url, { headers: getAuthHeader() });
      const body = res.data;
      const items = body.Data || body.Visits || [];
      const totalCount = body.MetaCollectionResult
        ? body.MetaCollectionResult.TotalCount
        : body.TotalCount;
      const lastTimestamp = body.MetaCollectionResult
        ? body.MetaCollectionResult.LastTimeStamp
        : body.LastTimeStamp;

      for (const v of items) {
        const visitDate =
          v.VisitStart
            ? v.VisitStart.substring(0, 10)
            : v.DateAndTime
            ? v.DateAndTime.substring(0, 10)
            : '';
        if (visitDate === dateStr) {
          results.push({
            repName: v.RepresentativeName || v.RepName || '',
            repEmail: v.RepresentativeEmail || v.RepEmail || '',
            clientName: v.ClientName || '',
            clientCode: v.ClientCode || '',
            visitStart: v.VisitStart || v.DateAndTime || '',
            visitEnd: v.VisitEnd || '',
            latitude: parseFloat(v.Latitude || v.Lat || 0),
            longitude: parseFloat(v.Longitude || v.Lon || 0),
            note: v.Note || '',
            scheduleNote: v.ScheduleNote || ''
          });
        }
      }

      if (!totalCount || totalCount === 0 || items.length === 0) break;
      if (!lastTimestamp || lastTimestamp === timestamp) break;
      timestamp = lastTimestamp;
    }
  } catch (err) {
    console.error('[Repsly] getVisitsForDate error:', err.message);
  }

  return results;
}

// Parse Repsly /Date(timestamp+offset)/ format to YYYY-MM-DD
function parseMsDate(dateStr) {
  if (!dateStr) return '';
  const match = String(dateStr).match(/\/Date\((\d+)([+-]\d+)?\)\//);
  if (match) return new Date(parseInt(match[1])).toISOString().substring(0, 10);
  return String(dateStr).substring(0, 10);
}

// GET /v3/export/photos/{timestamp} with pagination
// Returns per-rep arrays of { repName, repEmail, count, photoUrls[] }
async function getPhotosForDate(dateStr) {
  const photoMap = {};
  let timestamp = 0;

  try {
    while (true) {
      const url = `${BASE_URL}/export/photos/${timestamp}`;
      const res = await axios.get(url, { headers: getAuthHeader() });
      const body = res.data;
      const items = body.Data || body.Photos || [];
      const meta = body.MetaCollectionResult || {};
      const totalCount = meta.TotalCount ?? body.TotalCount;
      const lastTimestamp = meta.LastTimeStamp ?? body.LastTimeStamp;

      for (const p of items) {
        const photoDate = parseMsDate(p.DateAndTime);
        if (photoDate === dateStr) {
          const key = p.RepresentativeEmail || p.RepEmail || p.RepresentativeName || p.RepName || 'unknown';
          if (!photoMap[key]) {
            photoMap[key] = {
              repEmail: (p.RepresentativeEmail || p.RepEmail || ''),
              repName: (p.RepresentativeName || p.RepName || key),
              count: 0,
              photoUrls: []
            };
          }
          photoMap[key].count += 1;
          if (p.PhotoURL) photoMap[key].photoUrls.push(p.PhotoURL);
        }
      }

      if (!totalCount || totalCount === 0 || items.length === 0) break;
      if (!lastTimestamp || lastTimestamp === timestamp) break;
      timestamp = lastTimestamp;
    }
  } catch (err) {
    console.error('[Repsly] getPhotosForDate error:', err.message);
  }

  return Object.values(photoMap);
}

// GET /v3/export/forms/{timestamp} with pagination
async function getFormsForDate(dateStr) {
  const results = [];
  let timestamp = 0;

  try {
    while (true) {
      const url = `${BASE_URL}/export/forms/${timestamp}`;
      const res = await axios.get(url, { headers: getAuthHeader() });
      const body = res.data;
      const items = body.Data || body.Forms || [];
      const totalCount = body.MetaCollectionResult
        ? body.MetaCollectionResult.TotalCount
        : body.TotalCount;
      const lastTimestamp = body.MetaCollectionResult
        ? body.MetaCollectionResult.LastTimeStamp
        : body.LastTimeStamp;

      for (const f of items) {
        const formDate = f.DateAndTime ? f.DateAndTime.substring(0, 10) : '';
        if (formDate === dateStr) {
          results.push({
            repName: f.RepresentativeName || f.RepName || '',
            repEmail: f.RepresentativeEmail || f.RepEmail || '',
            clientName: f.ClientName || '',
            formName: f.FormName || f.DocumentName || '',
            submittedAt: f.DateAndTime || ''
          });
        }
      }

      if (!totalCount || totalCount === 0 || items.length === 0) break;
      if (!lastTimestamp || lastTimestamp === timestamp) break;
      timestamp = lastTimestamp;
    }
  } catch (err) {
    console.error('[Repsly] getFormsForDate error:', err.message);
  }

  return results;
}

// GET /v3/export/clientnotes/{id} with pagination
async function getClientNotesForDate(dateStr) {
  const results = [];
  let id = 0;

  try {
    while (true) {
      const url = `${BASE_URL}/export/clientnotes/${id}`;
      const res = await axios.get(url, { headers: getAuthHeader() });
      const body = res.data;
      const items = body.Data || body.ClientNotes || [];
      const totalCount = body.MetaCollectionResult
        ? body.MetaCollectionResult.TotalCount
        : body.TotalCount;
      const lastId = body.MetaCollectionResult
        ? body.MetaCollectionResult.LastTimeStamp
        : body.LastTimeStamp;

      for (const n of items) {
        const noteDate = n.DateAndTime ? n.DateAndTime.substring(0, 10) : '';
        if (noteDate === dateStr) {
          results.push({
            repName: n.RepresentativeName || n.RepName || '',
            repEmail: n.RepresentativeEmail || n.RepEmail || '',
            clientName: n.ClientName || '',
            note: n.Note || '',
            createdAt: n.DateAndTime || ''
          });
        }
      }

      if (!totalCount || totalCount === 0 || items.length === 0) break;
      if (!lastId || lastId === id) break;
      id = lastId;
    }
  } catch (err) {
    console.error('[Repsly] getClientNotesForDate error:', err.message);
  }

  return results;
}

// Aggregate all data for a date into per-rep summaries
async function getDailyRepSummary(dateStr) {
  console.log(`[Repsly] Fetching daily summary for ${dateStr}...`);

  const [visits, photos, forms, notes] = await Promise.all([
    getVisitsForDate(dateStr),
    getPhotosForDate(dateStr),
    getFormsForDate(dateStr),
    getClientNotesForDate(dateStr)
  ]);

  // Build rep map keyed by email (fall back to name)
  const repMap = {};

  function getRepKey(item) {
    return item.repEmail || item.repName || 'unknown';
  }

  function ensureRep(key, name, email) {
    if (!repMap[key]) {
      repMap[key] = {
        repName: name || key,
        repEmail: email || (key.includes('@') ? key : ''),
        checkIns: 0,
        photos: 0,
        photoUrls: [],
        formsCompleted: 0,
        formNames: [],
        kmTravelled: 0,
        notes: [],
        visitDetails: []
      };
    }
    // Fill in name/email if we have better data
    if (name && !repMap[key].repName) repMap[key].repName = name;
    if (email && !repMap[key].repEmail) repMap[key].repEmail = email;
  }

  // Process visits
  const visitsByRep = {};
  for (const v of visits) {
    const key = getRepKey(v);
    ensureRep(key, v.repName, v.repEmail);
    repMap[key].checkIns += 1;
    repMap[key].visitDetails.push({
      clientName: v.clientName,
      visitStart: v.visitStart,
      visitEnd: v.visitEnd,
      latitude: v.latitude,
      longitude: v.longitude,
      note: v.note
    });
    if (v.note) repMap[key].notes.push(v.note);

    if (!visitsByRep[key]) visitsByRep[key] = [];
    visitsByRep[key].push(v);
  }

  // Calculate KM travelled per rep using haversine on ordered visits
  for (const [key, repVisits] of Object.entries(visitsByRep)) {
    // Sort by visit start time
    const sorted = repVisits
      .filter((v) => v.latitude !== 0 && v.longitude !== 0)
      .sort((a, b) => new Date(a.visitStart) - new Date(b.visitStart));

    let totalKm = 0;
    for (let i = 1; i < sorted.length; i++) {
      totalKm += haversine(
        sorted[i - 1].latitude,
        sorted[i - 1].longitude,
        sorted[i].latitude,
        sorted[i].longitude
      );
    }
    if (repMap[key]) {
      repMap[key].kmTravelled = Math.round(totalKm * 10) / 10;
    }
  }

  // Process photos
  for (const p of photos) {
    const key = getRepKey(p);
    ensureRep(key, p.repName, p.repEmail);
    repMap[key].photos += p.count || 1;
    if (p.photoUrls && p.photoUrls.length) {
      repMap[key].photoUrls.push(...p.photoUrls);
    }
  }

  // Process forms
  for (const f of forms) {
    const key = getRepKey(f);
    ensureRep(key, f.repName, f.repEmail);
    repMap[key].formsCompleted += 1;
    if (f.formName && !repMap[key].formNames.includes(f.formName)) {
      repMap[key].formNames.push(f.formName);
    }
  }

  // Process client notes
  for (const n of notes) {
    const key = getRepKey(n);
    ensureRep(key, n.repName, n.repEmail);
    if (n.note) repMap[key].notes.push(`[${n.clientName}] ${n.note}`);
  }

  return Object.values(repMap);
}

module.exports = {
  getRepresentatives,
  getVisitsForDate,
  getPhotosForDate,
  getFormsForDate,
  getClientNotesForDate,
  getDailyRepSummary
};
