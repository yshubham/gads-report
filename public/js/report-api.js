// Shared API access functions for the external report and conversion endpoints.
// Defines API_BASES and STAKE_REPORT_SLUG in one place.

var API_BASES = ["https://admin.flipchat.link"];
var STAKE_REPORT_SLUG = "ipl2026";

async function tryFetchReport(slug, dateKey) {
  var lastError = null;
  for (var i = 0; i < API_BASES.length; i++) {
    var base = API_BASES[i];
    var datedUrl = base + "/api/reports/" + encodeURIComponent(slug) + "?date=" + encodeURIComponent(dateKey);
    var fallbackUrl = base + "/api/reports/" + encodeURIComponent(slug);
    try {
      var res = await fetch(datedUrl, { method: "GET", mode: "cors" });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        res = await fetch(fallbackUrl, { method: "GET", mode: "cors" });
        data = await res.json().catch(function () { return {}; });
      }
      if (!res.ok) {
        return { ok: false, message: data.error || "Request failed (" + res.status + ")" };
      }
      return { ok: true, data: data };
    } catch (e) {
      lastError = "Could not reach " + base;
    }
  }
  return {
    ok: false,
    message: lastError || "Network/CORS error. Check that the API is deployed and reachable."
  };
}

async function fetchConversionsForDate(dateKey) {
  var lastError = null;
  for (var i = 0; i < API_BASES.length; i++) {
    var base = API_BASES[i];
    var datedUrl = base + "/api/conversions?date=" + encodeURIComponent(dateKey);
    var fallbackUrl = base + "/api/conversions";
    try {
      var res = await fetch(datedUrl, { method: "GET", mode: "cors" });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        res = await fetch(fallbackUrl, { method: "GET", mode: "cors" });
        data = await res.json().catch(function () { return {}; });
      }
      if (!res.ok) {
        return { ok: false, message: data.error || "Request failed (" + res.status + ")" };
      }
      if (data.dateKey != null && String(data.dateKey) !== dateKey) {
        return { ok: true, data: null, dateMismatch: true, usedUndatedFallback: true };
      }
      var conversions = Number(data.conversions);
      if (!Number.isFinite(conversions) || conversions < 0) {
        return { ok: true, data: null };
      }
      return {
        ok: true,
        data: { conversions: Math.floor(conversions), updatedAt: data.updatedAt || null }
      };
    } catch (e) {
      lastError = "Could not reach " + base;
    }
  }
  return {
    ok: false,
    message: lastError || "Network/CORS error."
  };
}

function getStakeClicks(groupData) {
  if (!Array.isArray(groupData)) return 0;
  var stakeRow = groupData.find(function (row) {
    return String(row.group || "").trim().toLowerCase() === "stake";
  });
  var clicks = Number(stakeRow ? stakeRow.clicks : 0);
  return Number.isFinite(clicks) && clicks > 0 ? clicks : 0;
}
