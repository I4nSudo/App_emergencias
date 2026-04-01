/* eslint-disable */
import { useState, useEffect, useRef } from "react";
import * as React from "react";

// ============================================================
// ============================================================
const firebaseConfig = {
  apiKey:            "AIzaSyAB9NZxmE1kx5VSLRFM7LSIDTIc5rU17Nk",
  authDomain:        "emergency-dbapp.firebaseapp.com",
  projectId:         "emergency-dbapp",
  storageBucket:     "emergency-dbapp.firebasestorage.app",
  messagingSenderId: "640269128217",
  appId:             "1:640269128217:web:a607c5b7126ed0f64e1088",
  measurementId:     "G-T2S0NKKXMS",
};


// ============================================================
// 🗺️  LEAFLET — Mapa interactivo (carga desde CDN)
// ============================================================
let _leafletLoaded = false;
async function loadLeaflet() {
  if (_leafletLoaded && window.L) return window.L;
  return new Promise((resolve) => {
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    if (window.L) { _leafletLoaded = true; resolve(window.L); return; }
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => { _leafletLoaded = true; resolve(window.L); };
    document.head.appendChild(script);
  });
}

// Color por tipo de incidente
const INCIDENT_COLORS = {
  incidente:  "#FFCC00",
  incendio:   "#FF3B30",
  inundacion: "#007AFF",
  crimen:     "#FF3B30",
  medico:     "#34C759",
};

// Crea icono SVG personalizado para Leaflet
function makeLeafletIcon(color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
    <path d="M16 0C7.163 0 0 7.163 0 16c0 10 16 24 16 24S32 26 32 16C32 7.163 24.837 0 16 0z" fill="${color}" stroke="#111" stroke-width="2"/>
    <circle cx="16" cy="16" r="6" fill="white" opacity="0.9"/>
  </svg>`;
  return window.L.divIcon({
    html: svg,
    className: '',
    iconSize: [32, 40],
    iconAnchor: [16, 40],
    popupAnchor: [0, -40],
  });
}

// ============================================================
// FIREBASE SDK — carga dinámicamente desde CDN (sin npm)
// ============================================================
let _auth = null;
let _db   = null;
let _fbInitialized = false;

async function initFirebase() {
  if (_fbInitialized) return { auth: _auth, db: _db };

  const [
    { initializeApp },
    { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged },
    { getFirestore, collection, addDoc, getDocs, deleteDoc, doc, query, orderBy, where, serverTimestamp },
  ] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js"),
  ]);

  const app = initializeApp(firebaseConfig);
  _auth = { instance: getAuth(app), GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged };
  _db   = { instance: getFirestore(app), collection, addDoc, getDocs, deleteDoc, doc, query, orderBy, where, serverTimestamp };
  _fbInitialized = true;
  return { auth: _auth, db: _db };
}

// ── Auth ──
const AuthSvc = {
  loginWithGoogle: async () => {
    const { auth } = await initFirebase();
    const provider = new auth.GoogleAuthProvider();
    return auth.signInWithPopup(auth.instance, provider);
  },
  logout: async () => {
    const { auth } = await initFirebase();
    return auth.signOut(auth.instance);
  },
  onChange: async (cb) => {
    const { auth } = await initFirebase();
    return auth.onAuthStateChanged(auth.instance, cb);
  },
};

// ── Firestore reports ──
const ReportSvc = {
  add: async (data) => {
    const { db } = await initFirebase();
    return db.addDoc(db.collection(db.instance, "reports"), {
      ...data,
      created_at: db.serverTimestamp(),
    });
  },
  getAll: async () => {
    const { db } = await initFirebase();
    const q = db.query(db.collection(db.instance, "reports"), db.orderBy("created_at", "desc"));
    const snap = await db.getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data(), created_at: d.data().created_at?.toDate?.()?.toISOString() || new Date().toISOString() }));
  },
  delete: async (id) => {
    const { db } = await initFirebase();
    return db.deleteDoc(db.doc(db.instance, "reports", id));
  },
};

// ── Fallback: LocalStorage (cuando Firebase no está configurado) ──
const LocalDB = (() => {
  const KEY = "safetydb_reports_v2";
  const load = () => JSON.parse(localStorage.getItem(KEY) || "[]");
  const save = (d) => localStorage.setItem(KEY, JSON.stringify(d));
  return {
    add: (r) => { const rows = load(); const row = { ...r, id: String(Date.now()), created_at: new Date().toISOString() }; rows.unshift(row); save(rows); return row; },
    getAll: () => load(),
    delete: (id) => save(load().filter((r) => r.id !== id)),
  };
})();

const isFirebaseConfigured = () => firebaseConfig.apiKey !== "TU_API_KEY" && firebaseConfig.apiKey !== undefined && firebaseConfig.apiKey !== "";

// ── Geo & Weather ──
const GeoAPI = {
  getPosition: () => new Promise((res, rej) => navigator.geolocation ? navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000 }) : rej(new Error("No disponible"))),
  reverse: async (lat, lng) => { const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`); return r.json(); },
};
const WeatherAPI = {
  get: async (lat, lng) => { const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true&timezone=auto`); return r.json(); },
};
const SocialAPI = {
  getAlerts: async () => {
    const r = await fetch("https://api.github.com/repos/nicholasgasior/gsfmt/issues?state=open&per_page=8");
    const data = await r.json();
    return (Array.isArray(data) ? data : []).map((issue, i) => ({ id: issue.id, user: issue.user?.login || "usuario", title: issue.title, body: issue.body?.slice(0, 120) || "", created_at: issue.created_at, type: ["incidente", "advertencia", "alerta"][i % 3] }));
  },
};

// ============================================================
// ICONS
// ============================================================
const Icon = ({ name, size = 20, color = "currentColor" }) => {
  const I = {
    alert:     <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
    pin:       <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>,
    fire:      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5"><path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 3z"/></svg>,
    flood:     <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5"><path d="M3 12h18M3 17h18M12 2L8 7h8l-4-5z"/><path d="M5 17c0 2 1 3 2 3s2-1 2-3 1-3 2-3 2 1 2 3 1 3 2 3 2-1 2-3"/></svg>,
    crime:     <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>,
    medical:   <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/><path d="M12 8v8M8 12h8"/></svg>,
    send:      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
    cloud:     <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5"><path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/></svg>,
    users:     <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>,
    map:       <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>,
    trash:     <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>,
    exit:      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
    shield:    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
    dashboard: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>,
    wind:      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5"><path d="M9.59 4.59A2 2 0 1111 8H2m10.59 11.41A2 2 0 1014 16H2m15.73-8.27A2.5 2.5 0 1119.5 12H2"/></svg>,
    bell:      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>,
    check:     <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>,
    logout:    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
    google:    <svg width={size} height={size} viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>,
    user:      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  };
  return I[name] || null;
};

// ============================================================
// LOGIN SCREEN
// ============================================================
function LoginScreen({ onLogin, loading, error }) {
  return (
    <div style={LS.root}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;600;700;800;900&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Barlow', sans-serif; }
        .google-btn:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.15) !important; }
        .google-btn:active { transform: translateY(0); }
      `}</style>

      {/* Animated warning stripes background */}
      <div style={LS.stripesBg} />

      <div style={LS.card}>
        {/* Logo */}
        <div style={LS.logoRow}>
          <div style={LS.logoBox}>
            <Icon name="shield" size={32} color="#111" />
          </div>
          <div>
            <div style={LS.appName}>ZONA SEGURA</div>
            <div style={LS.appTagline}>Sistema de Seguridad Comunitaria</div>
          </div>
        </div>

        {/* Divider stripe */}
        <div style={LS.stripe} />

        {/* Welcome text */}
        <div style={LS.welcomeTitle}>Bienvenido</div>
        <p style={LS.welcomeText}>
          Inicia sesión con tu cuenta de Google para acceder al sistema de reportes y
          alertas de tu comunidad.
        </p>

        {/* Features list */}
        <div style={LS.featureList}>
          {[
            { icon: "pin",     color: "#FFCC00", text: "Reportes geolocalizados en tiempo real" },
            { icon: "map",     color: "#007AFF", text: "Mapa interactivo de incidentes" },
            { icon: "users",   color: "#34C759", text: "Feed de alertas comunitarias" },
            { icon: "cloud",   color: "#FF3B30", text: "Condiciones climáticas en vivo" },
          ].map((f) => (
            <div key={f.text} style={LS.featureRow}>
              <div style={{ ...LS.featureDot, background: f.color }}>
                <Icon name={f.icon} size={14} color={f.color === "#FFCC00" ? "#111" : "#fff"} />
              </div>
              <span style={LS.featureText}>{f.text}</span>
            </div>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div style={LS.errorBox}>
            <Icon name="alert" size={16} color="#FF3B30" />
            <span style={{ fontSize: 13, color: "#FF3B30" }}>{error}</span>
          </div>
        )}

        {/* Google button */}
        <button
          className="google-btn"
          style={LS.googleBtn}
          onClick={onLogin}
          disabled={loading}
        >
          {loading ? (
            <>
              <Spinner color="#555" size="sm" />
              <span>Conectando con Google...</span>
            </>
          ) : (
            <>
              <Icon name="google" size={22} />
              <span>Continuar con Google</span>
            </>
          )}
        </button>

        {!isFirebaseConfigured() && (
          <div style={LS.configWarning}>
            ⚠️ <strong>Modo Demo</strong> — Firebase no configurado.<br/>
            Al hacer clic entrarás como "Usuario Demo" usando almacenamiento local.
          </div>
        )}

        <p style={LS.disclaimer}>
          Al iniciar sesión aceptas que tu información de perfil de Google (nombre y foto)
          será visible en los reportes que publiques.
        </p>
      </div>

      {/* API badges bottom */}
      <div style={LS.apiBadgesRow}>
        {["Firebase Auth", "Geolocation API", "GitHub API", "Open-Meteo API"].map((a) => (
          <span key={a} style={LS.apiBadge}>{a}</span>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// MAIN APP (authenticated)
// ============================================================
export default function EmergencyApp() {
  const [user, setUser]               = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError]     = useState(null);
  const [loginLoading, setLoginLoading] = useState(false);

  const [tab, setTab]                 = useState("dashboard");
  const [location, setLocation]       = useState(null);
  const [address, setAddress]         = useState("Obteniendo ubicación...");
  const [weather, setWeather]         = useState(null);
  const [socialAlerts, setSocialAlerts] = useState([]);
  const [reports, setReports]         = useState([]);
  const [form, setForm]               = useState({ type: "incidente", title: "", desc: "" });
  const [loading, setLoading]         = useState({});
  const [toast, setToast]             = useState(null);
  const [mapUrl, setMapUrl]           = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [pickerCenter, setPickerCenter] = useState(null);
  const [refreshCountdown, setRefreshCountdown] = useState(30);
  const [lastRefresh, setLastRefresh] = useState(null);

  const showToast = (msg, type = "ok") => { setToast({ msg, type }); setTimeout(() => setToast(null), 3500); };
  const setLoad   = (k, v) => setLoading((p) => ({ ...p, [k]: v }));

  // ── Auth listener ──
  useEffect(() => {
    if (!isFirebaseConfigured()) {
      // Demo mode: show login screen, don't auto-login
      setAuthLoading(false);
      return;
    }
    AuthSvc.onChange((u) => {
      setUser(u);
      setAuthLoading(false);
    });
  }, []);

  // ── Load data when user is set ──
  useEffect(() => {
    if (!user) return;
    loadReports();
    initGeo();
    refreshFeed();

    // Auto-refresh feed every 30 seconds
    const refreshInterval = setInterval(() => {
      refreshFeed();
    }, 30000);

    // Countdown timer (ticks every second)
    const countdownInterval = setInterval(() => {
      setRefreshCountdown(prev => prev <= 1 ? 30 : prev - 1);
    }, 1000);

    return () => {
      clearInterval(refreshInterval);
      clearInterval(countdownInterval);
    };
  }, [user]);

  const loadReports = async () => {
    setLoad("reports", true);
    try {
      const data = isFirebaseConfigured() ? await ReportSvc.getAll() : LocalDB.getAll();
      setReports(data);
    } catch { setReports(LocalDB.getAll()); }
    finally { setLoad("reports", false); }
  };

  const initGeo = () => {
    setLoad("geo", true);
    GeoAPI.getPosition()
      .then(async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        setLocation({ lat, lng });
        setMapUrl(`https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.02},${lat - 0.02},${lng + 0.02},${lat + 0.02}&layer=mapnik&marker=${lat},${lng}`);
        setPickerCenter({ lat, lng });
        try { const g = await GeoAPI.reverse(lat, lng); setAddress(g.display_name?.split(",").slice(0, 3).join(", ") || "Ubicación obtenida"); }
        catch { setAddress(`${lat.toFixed(4)}, ${lng.toFixed(4)}`); }
        setLoad("weather", true);
        WeatherAPI.get(lat, lng).then(setWeather).catch(() => {}).finally(() => setLoad("weather", false));
      })
      .catch(() => { setAddress("Ubicación no disponible"); setLocation({ lat: 20.5888, lng: -100.3899 }); setMapUrl(`https://www.openstreetmap.org/export/embed.html?bbox=-100.41,20.57,-100.37,20.61&layer=mapnik&marker=20.5888,-100.3899`); })
      .finally(() => setLoad("geo", false));
  };

  const refreshFeed = async () => {
    setLoad("social", true);
    try {
      // Fetch GitHub alerts + Firestore reports in parallel
      const [githubAlerts, firestoreReports] = await Promise.allSettled([
        SocialAPI.getAlerts(),
        isFirebaseConfigured() ? ReportSvc.getAll() : Promise.resolve(LocalDB.getAll()),
      ]);

      const ghItems = (githubAlerts.status === "fulfilled" ? githubAlerts.value : []).map(a => ({
        ...a,
        source: "github",
        feed_date: a.created_at,
      }));

      const fsItems = (firestoreReports.status === "fulfilled" ? firestoreReports.value : []).map(r => ({
        id: "fs_" + r.id,
        user: r.userName || "Usuario",
        userPhoto: r.userPhoto || null,
        title: r.title,
        body: r.desc || "",
        type: r.type || "incidente",
        created_at: r.created_at,
        feed_date: r.created_at,
        source: "firestore",
        address: r.address,
        lat: r.lat,
        lng: r.lng,
      }));

      // Merge and sort by date descending
      const merged = [...ghItems, ...fsItems].sort((a, b) =>
        new Date(b.feed_date || 0) - new Date(a.feed_date || 0)
      );
      setSocialAlerts(merged);
      setReports(firestoreReports.status === "fulfilled" ? firestoreReports.value : LocalDB.getAll());
      setLastRefresh(new Date());
      setRefreshCountdown(30);
    } catch {
      setSocialAlerts([]);
    } finally {
      setLoad("social", false);
    }
  };

  // Keep old name as alias for compatibility
  const initSocial = refreshFeed;

  const handleLogin = async () => {
    setLoginLoading(true);
    setAuthError(null);
    try {
      if (!isFirebaseConfigured()) {
        setUser({ uid: "demo", displayName: "Usuario Demo", email: "demo@demo.com", photoURL: null });
      } else {
        await AuthSvc.loginWithGoogle();
      }
    } catch (e) {
      setAuthError(e.code === "auth/popup-closed-by-user" ? "Cerraste la ventana de Google. Intenta de nuevo." : `Error: ${e.message}`);
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    if (isFirebaseConfigured()) await AuthSvc.logout();
    setUser(null);
    setReports([]);
    setTab("dashboard");
  };

  const submitReport = async () => {
    if (!form.title.trim()) return showToast("Ingresa un título", "error");
    const finalLat = form.pickedLat ?? location?.lat;
    const finalLng = form.pickedLng ?? location?.lng;
    const finalAddress = form.pickedAddress || address;
    const data = { ...form, uid: user.uid, userName: user.displayName, userPhoto: user.photoURL, lat: finalLat, lng: finalLng, address: finalAddress };
    try {
      if (isFirebaseConfigured()) { await ReportSvc.add(data); await loadReports(); }
      else { LocalDB.add(data); setReports(LocalDB.getAll()); }
      setForm({ type: "incidente", title: "", desc: "", pickedLat: null, pickedLng: null, pickedAddress: null, searchAddress: "" });
      showToast("Reporte enviado ✓", "ok");
    } catch { showToast("Error al enviar. Intenta de nuevo.", "error"); }
  };

  const deleteReport = async (id) => {
    try {
      if (isFirebaseConfigured()) { await ReportSvc.delete(id); await loadReports(); }
      else { LocalDB.delete(id); setReports(LocalDB.getAll()); }
    } catch { showToast("Error al eliminar", "error"); }
  };

  // ── Loading / Login screens ──
  if (authLoading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#111", flexDirection: "column", gap: 16, fontFamily: "Barlow, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Barlow:wght@900&display=swap')`}</style>
      <div style={{ width: 56, height: 56, background: "#FFCC00", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", border: "3px solid #333" }}>
        <Icon name="shield" size={30} color="#111" />
      </div>
      <Spinner color="#FFCC00" />
      <div style={{ color: "#555", fontSize: 14, letterSpacing: 2, textTransform: "uppercase" }}>Cargando...</div>
    </div>
  );

  if (!user) return <LoginScreen onLogin={handleLogin} loading={loginLoading} error={authError} />;

  // ── Authenticated app ──
  const wc = weather?.current_weather;
  const weatherIcon = wc ? (wc.weathercode <= 3 ? "☀️" : wc.weathercode <= 67 ? "🌧️" : "⛄") : "—";
  const weatherDesc = wc ? (wc.weathercode <= 3 ? "Despejado" : wc.weathercode <= 45 ? "Nublado" : wc.weathercode <= 67 ? "Lluvia" : "Nieve") : "—";

  const incidentTypes = [
    { value: "incidente",  label: "Incidente General",  color: "#FFCC00", textColor: "#111", icon: "alert" },
    { value: "incendio",   label: "Incendio",            color: "#FF3B30", textColor: "#fff", icon: "fire" },
    { value: "inundacion", label: "Inundación",          color: "#007AFF", textColor: "#fff", icon: "flood" },
    { value: "crimen",     label: "Act. Criminal",       color: "#FF3B30", textColor: "#fff", icon: "crime" },
    { value: "medico",     label: "Emergencia Médica",   color: "#34C759", textColor: "#fff", icon: "medical" },
  ];

  const navItems = [
    { id: "dashboard", label: "Dashboard",     icon: "dashboard" },
    { id: "map",       label: "Mapa en Vivo",  icon: "map" },
    { id: "report",    label: "Nuevo Reporte", icon: "alert" },
    { id: "community", label: "Comunidad",     icon: "users" },
  ];

  // Only own reports visible for deletion (all visible)
  const myReports = reports.filter((r) => r.uid === user.uid || r.uid === "demo");

  return (
    <div style={S.root}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800;900&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Barlow', sans-serif; background: #1a1a1a; }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: #f0f0f0; } ::-webkit-scrollbar-thumb { background: #ccc; border-radius: 3px; }
        input:focus, textarea:focus { border-color: #FFCC00 !important; box-shadow: 0 0 0 3px rgba(255,204,0,0.15); outline: none; }
        .nav-item:hover { background: rgba(255,204,0,0.12) !important; }
        .report-card-hover:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.08); transform: translateY(-1px); transition: all 0.15s; }
        .submit-btn:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(255,204,0,0.4); }
        .submit-btn:active { transform: translateY(0); }
        .delete-btn:hover { background: #fff0f0 !important; }
        .type-btn:hover { transform: scale(1.02); }
        .logout-btn:hover { background: #fff0f0 !important; border-color: #FF3B30 !important; }
      `}</style>

      {/* ── SIDEBAR ── */}
      <aside style={{ ...S.sidebar, width: sidebarCollapsed ? 72 : 240 }}>
        {/* Logo */}
        <div style={S.sidebarLogo}>
          <div style={S.logoIcon}><Icon name="shield" size={24} color="#111" /></div>
          {!sidebarCollapsed && (
            <div style={{ overflow: "hidden" }}>
              <div style={S.logoText}>ZONA SEGURA</div>
              <div style={S.logoSub}>Seguridad Comunitaria</div>
            </div>
          )}
          <button style={S.collapseBtn} onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2.5">
              {sidebarCollapsed ? <polyline points="9 18 15 12 9 6"/> : <polyline points="15 18 9 12 15 6"/>}
            </svg>
          </button>
        </div>

        <div style={S.sidebarStripe} />

        {/* User profile */}
        <div style={{ ...S.userCard, justifyContent: sidebarCollapsed ? "center" : "flex-start" }}>
          {user.photoURL
            ? <img src={user.photoURL} alt="avatar" style={S.avatarImg} referrerPolicy="no-referrer" />
            : <div style={S.avatarFallback}>{(user.displayName || "U")[0].toUpperCase()}</div>}
          {!sidebarCollapsed && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={S.userName}>{user.displayName || "Usuario"}</div>
              <div style={S.userEmail}>{user.email}</div>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav style={S.sidebarNav}>
          {navItems.map((item) => (
            <button key={item.id} className="nav-item"
              style={{ ...S.navItem, background: tab === item.id ? "#FFCC00" : "transparent", justifyContent: sidebarCollapsed ? "center" : "flex-start" }}
              onClick={() => setTab(item.id)} title={sidebarCollapsed ? item.label : ""}>
              <Icon name={item.icon} size={20} color={tab === item.id ? "#111" : "#888"} />
              {!sidebarCollapsed && <span style={{ ...S.navLabel, color: tab === item.id ? "#111" : "#666" }}>{item.label}</span>}
              {!sidebarCollapsed && tab === item.id && <div style={S.navActiveDot} />}
            </button>
          ))}
        </nav>

        {/* APIs + Logout */}
        {!sidebarCollapsed && (
          <div style={S.sidebarBottom}>
            <div style={S.sidebarBottomTitle}>APIs Conectadas</div>
            {[
              { label: isFirebaseConfigured() ? "Firebase Auth ✓" : "Demo Mode", color: "#FFCC00" },
              { label: "Geolocation API", color: "#34C759" },
              { label: "GitHub API",      color: "#007AFF" },
              { label: "Open-Meteo API",  color: "#FF3B30" },
            ].map((api) => (
              <div key={api.label} style={S.apiRow}>
                <div style={{ ...S.apiDot, background: api.color }} />
                <span style={S.apiLabel}>{api.label}</span>
              </div>
            ))}
            <button className="logout-btn" style={S.logoutBtn} onClick={handleLogout}>
              <Icon name="logout" size={16} color="#FF3B30" />
              <span>Cerrar sesión</span>
            </button>
          </div>
        )}
        {sidebarCollapsed && (
          <div style={{ padding: "12px 10px" }}>
            <button className="logout-btn" style={{ ...S.logoutBtn, padding: "10px", justifyContent: "center" }} onClick={handleLogout} title="Cerrar sesión">
              <Icon name="logout" size={16} color="#FF3B30" />
            </button>
          </div>
        )}
      </aside>

      {/* ── MAIN ── */}
      <div style={S.mainArea}>
        {/* Topbar */}
        <header style={S.topbar}>
          <div>
            <div style={S.pageTitle}>{navItems.find(n => n.id === tab)?.label}</div>
            <div style={S.breadcrumb}>ZONA SEGURA &nbsp;/&nbsp; {navItems.find(n => n.id === tab)?.label}</div>
          </div>
          <div style={S.topbarRight}>
            {wc && (
              <div style={S.weatherPill}>
                <span style={{ fontSize: 18 }}>{weatherIcon}</span>
                <span style={{ fontWeight: 700, fontSize: 15 }}>{wc.temperature}°C</span>
                <span style={{ fontSize: 12, color: "#666" }}>{weatherDesc}</span>
                <span style={S.weatherDivider} />
                <Icon name="wind" size={13} color="#999" />
                <span style={{ fontSize: 12, color: "#888" }}>{wc.windspeed} km/h</span>
              </div>
            )}
            <div style={S.locationPill}>
              <Icon name="pin" size={14} color="#FFCC00" />
              <span style={S.locationPillText}>{loading.geo ? "Localizando..." : address.split(",")[0]}</span>
            </div>
            <div style={S.alertBadge}>
              <Icon name="bell" size={18} color="#FF3B30" />
              {reports.length > 0 && <span style={S.badgeCount}>{reports.length}</span>}
            </div>
          </div>
        </header>

        <main style={S.content}>

          {/* ══ DASHBOARD ══ */}
          {tab === "dashboard" && (
            <div style={S.dashGrid}>
              <div style={S.dashLeft}>
                <div style={S.statRow}>
                  <StatCard label="Mis Reportes"    value={myReports.length}      sub="publicados por ti"     bg="#111"     accent="#FFCC00" icon="alert"   badge="Firestore DB" />
                  <StatCard label="Alertas Sociales" value={loading.social ? "…" : socialAlerts.length} sub="en la comunidad" bg="#FF3B30" accent="#fff" icon="users" badge="GitHub API" />
                  <StatCard label="Temperatura"     value={wc ? `${wc.temperature}°` : "—"} sub={weatherDesc} bg="#FFCC00" accent="#111" icon="cloud" badge="Open-Meteo" dark />
                  <StatCard label="GPS"             value="Activo"               sub={address.split(",")[0]} bg="#34C759" accent="#fff" icon="pin" badge="Geolocation" />
                </div>

                <div style={S.panelCard}>
                  <div style={S.cardHeader}>
                    <Icon name="map" size={16} color="#111" />
                    <span style={S.cardHeaderText}>Vista del Mapa</span>
                    <span style={S.apiBadge}>OpenStreetMap</span>
                    <button style={S.viewAllBtn} onClick={() => setTab("map")}>Ver completo →</button>
                  </div>
                  <div style={{ height: 300, background: "#f5f5f5" }}>
                    {location ? (
                      <LeafletMap mode="view" center={location} zoom={13} reports={reports} incidentTypes={incidentTypes} />
                    ) : <MapPlaceholder loading={loading.geo} />}
                  </div>
                </div>

                <div style={S.panelCard}>
                  <div style={S.cardHeader}>
                    <Icon name="alert" size={16} color="#FF3B30" />
                    <span style={S.cardHeaderText}>Reportes de la Comunidad</span>
                    <span style={S.apiBadge}>{isFirebaseConfigured() ? "Firestore" : "LocalStorage"}</span>
                    <button style={S.viewAllBtn} onClick={() => setTab("community")}>Ver todos →</button>
                  </div>
                  {loading.reports ? <Spinner /> : reports.length === 0
                    ? <EmptyState msg="Sin reportes aún. ¡Sé el primero!" />
                    : reports.slice(0, 4).map((r) => (
                        <ReportCard key={r.id} report={r} onDelete={r.uid === user.uid || r.uid === "demo" ? deleteReport : null} types={incidentTypes} currentUser={user} />
                      ))}
                </div>
              </div>

              <div style={S.dashRight}>
                {/* Weather */}
                <div style={{ ...S.panelCard, background: "#111" }}>
                  <div style={{ ...S.cardHeader, borderColor: "#333" }}>
                    <Icon name="cloud" size={16} color="#FFCC00" />
                    <span style={{ ...S.cardHeaderText, color: "#fff" }}>Clima en Tiempo Real</span>
                    <span style={{ ...S.apiBadge, background: "#FFCC00", color: "#111" }}>Open-Meteo</span>
                  </div>
                  {loading.weather ? <Spinner color="#FFCC00" /> : wc ? (
                    <div style={{ padding: "0 18px 18px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 0 12px" }}>
                        <span style={{ fontSize: 60 }}>{weatherIcon}</span>
                        <div>
                          <div style={{ fontSize: 48, fontWeight: 900, color: "#FFCC00", lineHeight: 1 }}>{wc.temperature}°C</div>
                          <div style={{ color: "#aaa", fontSize: 14, marginTop: 4 }}>{weatherDesc}</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", borderTop: "1px solid #222" }}>
                        {[["VIENTO", `${wc.windspeed} km/h`], ["CÓDIGO", wc.weathercode], ["DIR.", `${wc.winddirection}°`]].map(([k, v]) => (
                          <div key={k} style={{ flex: 1, padding: "10px 0 6px 12px", borderRight: "1px solid #222" }}>
                            <div style={{ fontSize: 10, color: "#555", letterSpacing: 1, fontWeight: 700 }}>{k}</div>
                            <div style={{ fontSize: 17, fontWeight: 900, color: "#fff" }}>{v}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : <div style={{ color: "#555", padding: 18 }}>No disponible</div>}
                </div>

                {/* Social feed */}
                <div style={S.panelCard}>
                  <div style={S.cardHeader}>
                    <Icon name="users" size={16} color="#34C759" />
                    <span style={S.cardHeaderText}>Feed Comunitario</span>
                    <span style={{ ...S.apiBadge, background: "#34C759", color: "#fff" }}>Live</span>
                    <span style={{ fontSize: 11, color: "#aaa", marginLeft: "auto" }}>↺ {refreshCountdown}s</span>
                  </div>
                  {loading.social ? <Spinner /> : socialAlerts.slice(0, 4).map((a) => <FeedCard key={a.id} item={a} />)}
                </div>

                {/* Emergency exits */}
                <div style={S.greenInfoCard}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                    <div style={S.greenIconBox}><Icon name="exit" size={20} color="#34C759" /></div>
                    <strong style={{ fontSize: 15, color: "#fff" }}>SALIDAS DE EMERGENCIA</strong>
                  </div>
                  <p style={{ color: "rgba(255,255,255,0.8)", fontSize: 13, lineHeight: 1.6 }}>
                    Mantén rutas de evacuación libres. En emergencia real llama al <strong style={{ color: "#FFCC00" }}>911</strong>.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ══ MAP ══ */}
          {tab === "map" && (
            <div style={S.mapPage}>
              <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 112px)" }}>
                <div style={{ ...S.panelCard, flex: 1, display: "flex", flexDirection: "column" }}>
                  <div style={S.cardHeader}>
                    <Icon name="map" size={16} color="#111" />
                    <span style={S.cardHeaderText}>Mapa de Incidentes en Tiempo Real</span>
                    <span style={S.apiBadge}>OpenStreetMap · Nominatim</span>
                    {location && <span style={{ ...S.apiBadge, background: "#34C759", color: "#fff" }}>GPS Activo</span>}
                  </div>
                  <div style={{ flex: 1, minHeight: 0 }}>
                    {location ? (
                      <LeafletMap
                        mode="view"
                        center={location}
                        zoom={14}
                        reports={reports}
                        incidentTypes={incidentTypes}
                      />
                    ) : <MapPlaceholder loading={loading.geo} />}
                  </div>
                  {location && (
                    <div style={{ padding: "10px 16px", borderTop: "1px solid #f0f0f0", display: "flex", alignItems: "center", gap: 8, background: "#fafafa" }}>
                      <Icon name="pin" size={14} color="#FFCC00" />
                      <span style={{ fontSize: 13, color: "#555", flex: 1 }}>{address}</span>
                      <span style={{ fontSize: 12, color: "#aaa", fontFamily: "monospace" }}>{location.lat.toFixed(6)}, {location.lng.toFixed(6)}</span>
                      <span style={{ fontSize: 11, color: "#888", marginLeft: 8 }}>{reports.filter(r => r.lat && r.lng).length} incidentes mapeados</span>
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={S.panelCard}>
                  <div style={S.cardHeader}>
                    <Icon name="alert" size={16} color="#FF3B30" />
                    <span style={S.cardHeaderText}>Incidentes Activos</span>
                    <span style={S.badgeCount2}>{reports.length}</span>
                  </div>
                  {reports.length === 0 ? <EmptyState msg="Sin incidentes" /> : reports.map((r) => {
                    const t = incidentTypes.find((i) => i.value === r.type) || incidentTypes[0];
                    return (
                      <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: "1px solid #f9f9f9" }}>
                        <div style={{ width: 12, height: 12, borderRadius: "50%", background: t.color, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</div>
                          <div style={{ fontSize: 11, color: "#888" }}>{r.userName || "Usuario"}</div>
                        </div>
                        <span style={{ ...S.typePill, background: t.color, color: t.textColor, fontSize: 10 }}>{t.label.split(" ")[0]}</span>
                      </div>
                    );
                  })}
                </div>
                <div style={S.panelCard}>
                  <div style={S.cardHeader}><span style={S.cardHeaderText}>Leyenda</span></div>
                  {incidentTypes.map((t) => (
                    <div key={t.value} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", borderBottom: "1px solid #f9f9f9" }}>
                      <div style={{ width: 12, height: 12, borderRadius: 3, background: t.color }} />
                      <Icon name={t.icon} size={14} color={t.color} />
                      <span style={{ fontSize: 13, color: "#444" }}>{t.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ══ REPORT ══ */}
          {tab === "report" && (
            <div style={S.reportPage}>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ background: "#FFCC00", borderRadius: 12, padding: "16px 20px", display: "flex", alignItems: "center", gap: 16, border: "2px solid #111" }}>
                  <div style={{ width: 48, height: 48, background: "#111", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, flexShrink: 0 }}>⚠️</div>
                  <div>
                    <div style={{ fontWeight: 900, fontSize: 16, color: "#111" }}>EMERGENCIA REAL → LLAMA AL 911</div>
                    <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>Esta app es para reportes informativos comunitarios, no reemplaza al 911.</div>
                  </div>
                </div>

                <div style={S.panelCard}>
                  <div style={S.cardHeader}>
                    <Icon name="alert" size={16} color="#FF3B30" />
                    <span style={S.cardHeaderText}>Nuevo Reporte</span>
                    <span style={{ ...S.apiBadge, background: "#007AFF", color: "#fff" }}>{isFirebaseConfigured() ? "Firestore" : "LocalStorage"}</span>
                    <span style={{ ...S.apiBadge, background: "#34C759", color: "#fff" }}>Geolocation</span>
                  </div>

                  {/* Reporting as */}
                  <div style={{ padding: "12px 18px", background: "#f9f9f9", borderBottom: "1px solid #f0f0f0", display: "flex", alignItems: "center", gap: 10 }}>
                    {user.photoURL
                      ? <img src={user.photoURL} alt="av" style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }} referrerPolicy="no-referrer" />
                      : <div style={{ width: 28, height: 28, background: "#111", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", color: "#FFCC00", fontWeight: 900, fontSize: 13 }}>{(user.displayName || "U")[0]}</div>}
                    <div style={{ fontSize: 13, color: "#555" }}>Reportando como <strong style={{ color: "#111" }}>{user.displayName}</strong></div>
                    <span style={{ ...S.apiBadge, marginLeft: "auto", background: "#FFCC00", color: "#111" }}>Firebase Auth</span>
                  </div>

                  <div style={{ padding: "20px" }}>
                    <div style={{ marginBottom: 24 }}>
                      <FormLabel>TIPO DE INCIDENTE</FormLabel>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 10 }}>
                        {incidentTypes.map((t) => (
                          <button key={t.value} className="type-btn" style={{ ...S.typeBtn, background: form.type === t.value ? t.color : "#f5f5f5", color: form.type === t.value ? t.textColor : "#555", border: `2px solid ${form.type === t.value ? t.color : "#e8e8e8"}`, boxShadow: form.type === t.value ? `0 4px 12px ${t.color}55` : "none" }} onClick={() => setForm((p) => ({ ...p, type: t.value }))}>
                            <Icon name={t.icon} size={18} color={form.type === t.value ? t.textColor : "#888"} />
                            <span style={{ fontWeight: 700, fontSize: 13 }}>{t.label}</span>
                            {form.type === t.value && <div style={{ marginLeft: "auto" }}><Icon name="check" size={14} color={t.textColor} /></div>}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div style={{ marginBottom: 20 }}>
                      <FormLabel>UBICACIÓN DEL INCIDENTE</FormLabel>
                      <div style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>
                        📍 Haz clic en el mapa o arrastra el marcador para ajustar la ubicación exacta del incidente
                      </div>
                      {/* Buscador de dirección */}
                      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                        <input
                          style={{ ...S.input, flex: 1, padding: "10px 14px" }}
                          placeholder="Buscar dirección... ej. Av. Constituyentes 45"
                          value={form.searchAddress || ""}
                          onChange={(e) => setForm((p) => ({ ...p, searchAddress: e.target.value }))}
                          onKeyDown={async (e) => {
                            if (e.key === "Enter" && form.searchAddress?.trim()) {
                              try {
                                const q = encodeURIComponent(form.searchAddress + ", Queretaro, Mexico");
                                const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`);
                                const data = await r.json();
                                if (data[0]) {
                                  const newLat = parseFloat(data[0].lat);
                                  const newLng = parseFloat(data[0].lon);
                                  setForm((p) => ({ ...p, pickedLat: newLat, pickedLng: newLng, pickedAddress: data[0].display_name }));
                                  setPickerCenter({ lat: newLat, lng: newLng });
                                } else {
                                  showToast("Dirección no encontrada", "error");
                                }
                              } catch { showToast("Error al buscar dirección", "error"); }
                            }
                          }}
                        />
                        <button
                          style={{ ...S.submitBtn, width: "auto", padding: "10px 16px", fontSize: 13 }}
                          onClick={async () => {
                            if (!form.searchAddress?.trim()) return;
                            try {
                              const q = encodeURIComponent(form.searchAddress + ", Queretaro, Mexico");
                              const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`);
                              const data = await r.json();
                              if (data[0]) {
                                const newLat = parseFloat(data[0].lat);
                                const newLng = parseFloat(data[0].lon);
                                setForm((p) => ({ ...p, pickedLat: newLat, pickedLng: newLng, pickedAddress: data[0].display_name }));
                                setPickerCenter({ lat: newLat, lng: newLng });
                              } else {
                                showToast("Dirección no encontrada", "error");
                              }
                            } catch { showToast("Error al buscar dirección", "error"); }
                          }}
                        >
                          <Icon name="pin" size={16} color="#111" />
                          Buscar
                        </button>
                      </div>
                      {/* Mapa clickeable */}
                      <div style={{ height: 280, borderRadius: 10, overflow: "hidden", border: "2px solid #e8e8e8", marginBottom: 10 }}>
                        {(pickerCenter || location) ? (
                          <LeafletMap
                            mode="picker"
                            center={pickerCenter || location}
                            zoom={15}
                            onLocationPick={async ({ lat: newLat, lng: newLng }) => {
                              try {
                                const g = await GeoAPI.reverse(newLat, newLng);
                                setForm((p) => ({ ...p, pickedLat: newLat, pickedLng: newLng, pickedAddress: g.display_name || `${newLat.toFixed(5)}, ${newLng.toFixed(5)}` }));
                              } catch {
                                setForm((p) => ({ ...p, pickedLat: newLat, pickedLng: newLng, pickedAddress: `${newLat.toFixed(5)}, ${newLng.toFixed(5)}` }));
                              }
                            }}
                          />
                        ) : (
                          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#f5f5f5", color: "#bbb", fontSize: 13 }}>
                            <Spinner /> Obteniendo GPS...
                          </div>
                        )}
                      </div>
                      {/* Resumen de ubicación seleccionada */}
                      <div style={{ background: "#f5f5f5", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, border: "1px solid #e8e8e8" }}>
                        <Icon name="pin" size={15} color="#FFCC00" />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {form.pickedAddress ? form.pickedAddress.split(",").slice(0, 2).join(",") : (address.split(",").slice(0, 2).join(",") || "Sin seleccionar")}
                          </div>
                          {(form.pickedLat || location?.lat) && (
                            <div style={{ fontSize: 11, color: "#888", fontFamily: "monospace" }}>
                              {(form.pickedLat || location?.lat)?.toFixed(5)}, {(form.pickedLng || location?.lng)?.toFixed(5)}
                            </div>
                          )}
                        </div>
                        <span style={{ ...S.typePill, background: (form.pickedLat || location) ? "#34C759" : "#ccc", color: "#fff", fontSize: 10 }}>
                          {form.pickedLat ? "📍 Personalizado" : location ? "GPS" : "Sin GPS"}
                        </span>
                      </div>
                    </div>

                    <div style={{ marginBottom: 16 }}>
                      <FormLabel>TÍTULO *</FormLabel>
                      <input style={S.input} placeholder="ej. Semáforo caído en Av. Principal" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} />
                    </div>
                    <div style={{ marginBottom: 24 }}>
                      <FormLabel>DESCRIPCIÓN</FormLabel>
                      <textarea style={{ ...S.input, minHeight: 110, resize: "vertical" }} placeholder="Describe el incidente con el mayor detalle posible..." value={form.desc} onChange={(e) => setForm((p) => ({ ...p, desc: e.target.value }))} />
                    </div>

                    <button className="submit-btn" style={S.submitBtn} onClick={submitReport}>
                      <Icon name="send" size={20} color="#111" />
                      ENVIAR REPORTE A LA COMUNIDAD
                    </button>
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ ...S.panelCard, background: "#FF3B30" }}>
                  <div style={{ ...S.cardHeader, borderColor: "rgba(255,255,255,0.2)" }}>
                    <Icon name="bell" size={16} color="#fff" />
                    <span style={{ ...S.cardHeaderText, color: "#fff" }}>Números de Emergencia</span>
                  </div>
                  {[["911","Emergencias Generales"],["800 911 2000","CENACOM"],["074","Protección Civil"],["800 290 0024","Cruz Roja"]].map(([num, label]) => (
                    <div key={num} style={{ padding: "10px 18px", borderBottom: "1px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", gap: 14 }}>
                      <div style={{ fontSize: 20, fontWeight: 900, color: "#fff", minWidth: 110, fontFamily: "monospace" }}>{num}</div>
                      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>{label}</div>
                    </div>
                  ))}
                </div>
                <div style={S.greenInfoCard}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                    <div style={S.greenIconBox}><Icon name="exit" size={20} color="#34C759" /></div>
                    <strong style={{ fontSize: 14, color: "#fff" }}>RUTAS DE EVACUACIÓN</strong>
                  </div>
                  {["Identifica las salidas más cercanas","Mantén las rutas libres de obstáculos","Las señales de salida son siempre en verde","Ensaya periódicamente con tu familia"].map((tip, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      <div style={{ width: 6, height: 6, borderRadius: "50%", background: "rgba(255,255,255,0.5)", flexShrink: 0 }} />
                      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.85)" }}>{tip}</span>
                    </div>
                  ))}
                </div>
                <div style={S.panelCard}>
                  <div style={S.cardHeader}>
                    <Icon name="user" size={16} color="#FFCC00" />
                    <span style={S.cardHeaderText}>Mis Reportes ({myReports.length})</span>
                  </div>
                  {myReports.length === 0 ? <EmptyState msg="Aún no tienes reportes" /> : myReports.slice(0, 3).map((r) => <ReportCard key={r.id} report={r} onDelete={deleteReport} types={incidentTypes} compact currentUser={user} />)}
                </div>
              </div>
            </div>
          )}

          {/* ══ COMMUNITY ══ */}
          {tab === "community" && (
            <div style={S.communityGrid}>
              <div style={S.panelCard}>
                <div style={S.cardHeader}>
                  <Icon name="users" size={16} color="#34C759" />
                  <span style={S.cardHeaderText}>Feed Comunitario en Vivo</span>
                  <span style={{ ...S.apiBadge, background: "#34C759", color: "#fff" }}>Firestore</span>
                  <span style={{ ...S.apiBadge, background: "#111", color: "#fff" }}>GitHub API</span>
                  {/* Countdown + refresh button */}
                  <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#f5f5f5", borderRadius: 20, padding: "4px 12px", border: "1px solid #eee" }}>
                      <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#34C759", animation: "pulse 1.5s infinite" }} />
                      <span style={{ fontSize: 11, color: "#666", fontWeight: 700 }}>
                        Actualiza en {refreshCountdown}s
                      </span>
                    </div>
                    <button
                      style={{ background: "#FFCC00", border: "none", borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontWeight: 700, fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}
                      onClick={refreshFeed}
                      title="Actualizar ahora"
                    >
                      ↺ Ahora
                    </button>
                  </div>
                </div>
                {/* Last refresh time */}
                {lastRefresh && (
                  <div style={{ padding: "6px 18px", background: "#fafafa", borderBottom: "1px solid #f0f0f0", fontSize: 11, color: "#aaa" }}>
                    Última actualización: {lastRefresh.toLocaleTimeString("es-MX")}
                    &nbsp;·&nbsp;
                    {socialAlerts.filter(a => a.source === "firestore").length} reportes
                    &nbsp;+&nbsp;
                    {socialAlerts.filter(a => a.source === "github").length} alertas externas
                  </div>
                )}
                <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
                {loading.social ? <Spinner /> : socialAlerts.length === 0
                  ? <EmptyState msg="Sin actividad aún. ¡Crea el primer reporte!" />
                  : socialAlerts.map((a) => <FeedCard key={a.id} item={a} />)}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={S.panelCard}>
                  <div style={S.cardHeader}>
                    <Icon name="alert" size={16} color="#FF3B30" />
                    <span style={S.cardHeaderText}>Todos los Reportes</span>
                    <span style={S.apiBadge}>{isFirebaseConfigured() ? "Firestore" : "LocalStorage"}</span>
                    <span style={S.badgeCount2}>{reports.length}</span>
                  </div>
                  {loading.reports ? <Spinner /> : reports.length === 0
                    ? <EmptyState msg="Sin reportes" />
                    : reports.map((r) => <ReportCard key={r.id} report={r} onDelete={r.uid === user.uid || r.uid === "demo" ? deleteReport : null} types={incidentTypes} currentUser={user} />)}
                </div>

                <div style={{ ...S.panelCard, background: "#111" }}>
                  <div style={{ ...S.cardHeader, borderColor: "#333" }}>
                    <Icon name="dashboard" size={16} color="#FFCC00" />
                    <span style={{ ...S.cardHeaderText, color: "#fff" }}>Estadísticas</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-around", padding: "20px 16px" }}>
                    {incidentTypes.map((t) => {
                      const count = reports.filter((r) => r.type === t.value).length;
                      return (
                        <div key={t.value} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                          <div style={{ width: 24, borderRadius: 4, background: t.color, height: Math.max(4, count * 14), marginBottom: 4 }} />
                          <div style={{ fontSize: 20, fontWeight: 900, color: t.color }}>{count}</div>
                          <div style={{ fontSize: 10, color: "#666", textAlign: "center" }}>{t.label.split(" ")[0]}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {toast && (
        <div style={{ ...S.toast, background: toast.type === "error" ? "#FF3B30" : "#34C759" }}>
          <Icon name={toast.type === "ok" ? "check" : "alert"} size={16} color="#fff" />
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ── SUB-COMPONENTS ──
function StatCard({ label, value, sub, bg, accent, icon, badge, dark }) {
  return (
    <div style={{ background: bg, borderRadius: 14, padding: "18px 16px", minHeight: 130 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div style={{ width: 36, height: 36, background: dark ? "#111" : "rgba(255,255,255,0.2)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name={icon} size={18} color={dark ? accent : "#fff"} />
        </div>
        <span style={{ background: "rgba(0,0,0,0.2)", color: dark ? "#555" : "rgba(255,255,255,0.7)", borderRadius: 6, padding: "3px 7px", fontSize: 9, fontWeight: 700 }}>{badge}</span>
      </div>
      <div style={{ fontSize: 36, fontWeight: 900, color: accent, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: dark ? "#333" : "rgba(255,255,255,0.6)", marginTop: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 12, color: dark ? "#555" : "rgba(255,255,255,0.8)", marginTop: 2, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{sub}</div>
    </div>
  );
}

function ReportCard({ report, onDelete, types, compact, currentUser }) {
  const t = types.find((i) => i.value === report.type) || types[0];
  const isOwn = currentUser && (report.uid === currentUser.uid || report.uid === "demo");
  return (
    <div className="report-card-hover" style={{ display: "flex", overflow: "hidden", borderBottom: "1px solid #f5f5f5" }}>
      <div style={{ width: 5, background: t.color, flexShrink: 0 }} />
      <div style={{ flex: 1, padding: "12px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
            <Icon name={t.icon} size={16} color={t.color} />
            <strong style={{ fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{report.title}</strong>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <span style={{ ...S.typePill, background: t.color, color: t.textColor, fontSize: 10 }}>{t.label.split(" ")[0]}</span>
            {isOwn && onDelete && (
              <button className="delete-btn" style={S.deleteBtn} onClick={() => onDelete(report.id)}><Icon name="trash" size={14} color="#ccc" /></button>
            )}
          </div>
        </div>
        {!compact && report.desc && <div style={{ fontSize: 12, color: "#666", marginTop: 6, lineHeight: 1.5 }}>{report.desc}</div>}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
          {report.userPhoto
            ? <img src={report.userPhoto} alt="av" style={{ width: 16, height: 16, borderRadius: "50%", objectFit: "cover" }} referrerPolicy="no-referrer" />
            : <div style={{ width: 16, height: 16, background: "#ddd", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 900, color: "#888" }}>{(report.userName || "U")[0]}</div>}
          <span style={{ fontSize: 11, color: "#888" }}>{report.userName || "Usuario"}</span>
          <Icon name="pin" size={11} color="#ddd" />
          <span style={{ fontSize: 11, color: "#aaa" }}>{report.address?.split(",")[0] || "Sin dirección"}</span>
          <span style={{ marginLeft: "auto", fontSize: 11, color: "#ccc" }}>{report.created_at ? new Date(report.created_at).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" }) : ""}</span>
        </div>
      </div>
    </div>
  );
}


// ── FEED CARD — renders both Firestore reports and GitHub alerts ──
function FeedCard({ item }) {
  const isReport = item.source === "firestore";
  const typeColors = {
    incidente: { bg: "#FFCC00", text: "#111" },
    incendio:  { bg: "#FF3B30", text: "#fff" },
    inundacion:{ bg: "#007AFF", text: "#fff" },
    crimen:    { bg: "#FF3B30", text: "#fff" },
    medico:    { bg: "#34C759", text: "#fff" },
    alerta:    { bg: "#FF3B30", text: "#fff" },
    advertencia:{ bg: "#FFCC00", text: "#111" },
    incidente_gh:{ bg: "#34C759", text: "#fff" },
  };
  const typeLabels = {
    incidente: "Incidente", incendio: "Incendio", inundacion: "Inundación",
    crimen: "Criminal", medico: "Médico",
    alerta: "Alerta", advertencia: "Advertencia",
  };
  const tc = typeColors[item.type] || { bg: "#888", text: "#fff" };
  const label = typeLabels[item.type] || item.type?.toUpperCase() || "ALERTA";

  return (
    <div style={{ padding: "14px 18px", borderBottom: "1px solid #f5f5f5" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Avatar */}
          {isReport && item.userPhoto
            ? <img src={item.userPhoto} alt="av" style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover", border: "2px solid #FFCC00" }} referrerPolicy="no-referrer" />
            : <div style={{ width: 36, height: 36, background: isReport ? "#111" : "#24292e", color: isReport ? "#FFCC00" : "#fff", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 15, flexShrink: 0 }}>
                {(item.user || "U")[0].toUpperCase()}
              </div>
          }
          <div>
            <strong style={{ fontSize: 13, color: "#111" }}>{item.user}</strong>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
              <span style={{ fontSize: 10, color: "#aaa" }}>
                {item.created_at ? new Date(item.created_at).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" }) : ""}
              </span>
              {/* Source badge */}
              <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 4,
                background: isReport ? "#FFCC00" : "#24292e",
                color: isReport ? "#111" : "#fff" }}>
                {isReport ? "⚡ ZONA SEGURA" : "◆ GitHub"}
              </span>
            </div>
          </div>
        </div>
        <span style={{ background: tc.bg, color: tc.text, borderRadius: 20, padding: "3px 10px", fontSize: 10, fontWeight: 800, whiteSpace: "nowrap" }}>
          {label.toUpperCase()}
        </span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6, color: "#111" }}>{item.title}</div>
      {item.body && (
        <div style={{ fontSize: 13, color: "#666", lineHeight: 1.5 }}>
          {item.body.slice(0, 140)}{item.body.length > 140 ? "..." : ""}
        </div>
      )}
      {/* Location for Firestore reports */}
      {isReport && item.address && (
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 8 }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#FFCC00" strokeWidth="2.5">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
          </svg>
          <span style={{ fontSize: 11, color: "#aaa" }}>{item.address.split(",").slice(0, 2).join(",")}</span>
        </div>
      )}
    </div>
  );
}

function SocialCard({ alert: a, expanded }) {
  const colors = { alerta: "#FF3B30", advertencia: "#FFCC00", incidente: "#34C759" };
  const textColors = { alerta: "#fff", advertencia: "#111", incidente: "#fff" };
  return (
    <div style={{ padding: "14px 18px", borderBottom: "1px solid #f5f5f5" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, background: "#111", color: "#FFCC00", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 15, flexShrink: 0 }}>{a.user[0].toUpperCase()}</div>
          <div>
            <strong style={{ fontSize: 13 }}>{a.user}</strong>
            <div style={{ fontSize: 11, color: "#aaa" }}>{new Date(a.created_at).toLocaleDateString("es-MX")}</div>
          </div>
        </div>
        <span style={{ ...S.typePill, background: colors[a.type] || "#34C759", color: textColors[a.type] || "#fff" }}>{a.type.toUpperCase()}</span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{a.title}</div>
      {expanded && a.body && <div style={{ fontSize: 13, color: "#666", lineHeight: 1.5 }}>{a.body}</div>}
    </div>
  );
}

function Spinner({ color = "#FFCC00", size }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: size === "sm" ? 0 : 20 }}>
      <div style={{ width: size === "sm" ? 16 : 28, height: size === "sm" ? 16 : 28, border: `3px solid ${color}33`, borderTop: `3px solid ${color}`, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function MapPlaceholder({ loading: l }) {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#f5f5f5" }}>
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ddd" strokeWidth="2"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/></svg>
      <div style={{ color: "#bbb", marginTop: 12, fontSize: 14 }}>{l ? "Obteniendo GPS..." : "Mapa no disponible"}</div>
    </div>
  );
}

function EmptyState({ msg }) { return <div style={{ padding: "24px 16px", textAlign: "center", color: "#bbb", fontSize: 13 }}>{msg}</div>; }
function FormLabel({ children }) { return <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: "uppercase", color: "#888", marginBottom: 8 }}>{children}</div>; }


// ============================================================
// LEAFLET MAP COMPONENT (usado en formulario de reporte y mapa en vivo)
// mode: "picker" = seleccionar ubicación | "view" = ver reportes con marcadores
// ============================================================
function LeafletMap({ mode = "picker", center, zoom = 15, onLocationPick, reports = [], incidentTypes = [] }) {
  const mapRef = React.useRef(null);
  const leafletMapRef = React.useRef(null);
  const markerRef = React.useRef(null);
  const markersRef = React.useRef([]);

  useEffect(() => {
    let mounted = true;
    loadLeaflet().then((L) => {
      if (!mounted || !mapRef.current) return;
      if (leafletMapRef.current) {
        // Already initialized — just update center if needed
        if (center) leafletMapRef.current.setView([center.lat, center.lng], zoom);
        return;
      }

      const lat = center?.lat || 20.5888;
      const lng = center?.lng || -100.3899;

      const map = L.map(mapRef.current, { zoomControl: true, scrollWheelZoom: true }).setView([lat, lng], zoom);
      leafletMapRef.current = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);

      if (mode === 'picker') {
        // Add initial marker at GPS position
        markerRef.current = L.marker([lat, lng], {
          draggable: true,
          icon: makeLeafletIcon('#FFCC00'),
        }).addTo(map).bindPopup('<b>📍 Ubicación del incidente</b><br>Arrastra o haz clic para mover').openPopup();

        // Click to move marker
        map.on('click', (e) => {
          const { lat: newLat, lng: newLng } = e.latlng;
          markerRef.current.setLatLng([newLat, newLng]);
          if (onLocationPick) onLocationPick({ lat: newLat, lng: newLng });
        });

        // Drag to move marker
        markerRef.current.on('dragend', (e) => {
          const { lat: newLat, lng: newLng } = e.target.getLatLng();
          if (onLocationPick) onLocationPick({ lat: newLat, lng: newLng });
        });

        if (onLocationPick) onLocationPick({ lat, lng });
      }

      if (mode === 'view') {
        // Render all report markers
        reports.forEach((r) => {
          if (!r.lat || !r.lng) return;
          const t = incidentTypes.find((i) => i.value === r.type) || incidentTypes[0];
          const icon = makeLeafletIcon(t.color);
          const marker = L.marker([r.lat, r.lng], { icon }).addTo(map);
          marker.bindPopup(`
            <div style="font-family:Arial,sans-serif;min-width:180px">
              <div style="background:${t.color};color:${t.textColor};padding:4px 8px;border-radius:4px;font-size:11px;font-weight:700;margin-bottom:6px">${t.label.toUpperCase()}</div>
              <strong style="font-size:13px">${r.title}</strong>
              ${r.desc ? `<p style="font-size:12px;color:#555;margin:4px 0">${r.desc.slice(0,100)}${r.desc.length>100?'...':''}</p>` : ''}
              <div style="font-size:11px;color:#888;margin-top:6px">👤 ${r.userName || 'Usuario'}</div>
              <div style="font-size:11px;color:#aaa">📍 ${r.address?.split(',')[0] || 'Sin dirección'}</div>
            </div>
          `);
          markersRef.current.push(marker);
        });
      }
    });
    return () => { mounted = false; };
  }, []);

  // Update markers when reports change (view mode)
  useEffect(() => {
    if (mode !== 'view' || !leafletMapRef.current || !window.L) return;
    loadLeaflet().then((L) => {
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];
      reports.forEach((r) => {
        if (!r.lat || !r.lng) return;
        const t = incidentTypes.find((i) => i.value === r.type) || incidentTypes[0];
        const icon = makeLeafletIcon(t.color);
        const marker = L.marker([r.lat, r.lng], { icon }).addTo(leafletMapRef.current);
        marker.bindPopup(`
          <div style="font-family:Arial,sans-serif;min-width:180px">
            <div style="background:${t.color};color:${t.textColor};padding:4px 8px;border-radius:4px;font-size:11px;font-weight:700;margin-bottom:6px">${t.label.toUpperCase()}</div>
            <strong style="font-size:13px">${r.title}</strong>
            ${r.desc ? `<p style="font-size:12px;color:#555;margin:4px 0">${r.desc.slice(0,100)}${r.desc.length>100?'...':''}</p>` : ''}
            <div style="font-size:11px;color:#888;margin-top:6px">👤 ${r.userName || 'Usuario'}</div>
            <div style="font-size:11px;color:#aaa">📍 ${r.address?.split(',')[0] || 'Sin dirección'}</div>
          </div>
        `);
        markersRef.current.push(marker);
      });
    });
  }, [reports]);

  return <div ref={mapRef} style={{ width: '100%', height: '100%', borderRadius: 0 }} />;
}

// ── LOGIN STYLES ──
const LS = {
  root: { minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#111", fontFamily: "'Barlow', sans-serif", padding: 20, position: "relative", overflow: "hidden" },
  stripesBg: { position: "absolute", top: 0, left: 0, right: 0, height: 8, background: "repeating-linear-gradient(45deg, #FFCC00 0, #FFCC00 12px, #111 12px, #111 24px)", zIndex: 10 },
  card: { background: "#fff", borderRadius: 20, padding: "40px 40px 32px", width: "100%", maxWidth: 460, boxShadow: "0 24px 80px rgba(0,0,0,0.5)", position: "relative", zIndex: 5 },
  logoRow: { display: "flex", alignItems: "center", gap: 14, marginBottom: 20 },
  logoBox: { width: 56, height: 56, background: "#FFCC00", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", border: "3px solid #111", flexShrink: 0 },
  appName: { fontWeight: 900, fontSize: 22, letterSpacing: 3, color: "#111", lineHeight: 1 },
  appTagline: { fontSize: 11, color: "#888", letterSpacing: 1, marginTop: 3 },
  stripe: { height: 6, background: "repeating-linear-gradient(45deg, #FFCC00 0, #FFCC00 8px, #111 8px, #111 16px)", borderRadius: 3, marginBottom: 24 },
  welcomeTitle: { fontSize: 26, fontWeight: 900, color: "#111", marginBottom: 8 },
  welcomeText: { fontSize: 14, color: "#666", lineHeight: 1.6, marginBottom: 24 },
  featureList: { marginBottom: 28 },
  featureRow: { display: "flex", alignItems: "center", gap: 12, marginBottom: 10 },
  featureDot: { width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  featureText: { fontSize: 13, color: "#444", fontWeight: 600 },
  errorBox: { background: "#fff5f5", border: "1px solid #ffdddd", borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "center", gap: 8, marginBottom: 16 },
  googleBtn: { width: "100%", background: "#fff", border: "2px solid #e0e0e0", borderRadius: 12, padding: "14px 20px", fontSize: 16, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 12, fontFamily: "inherit", color: "#333", boxShadow: "0 2px 8px rgba(0,0,0,0.06)", transition: "all 0.2s", marginBottom: 16 },
  configWarning: { background: "#fffbec", border: "1px solid #FFCC00", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#666", marginBottom: 12, textAlign: "center" },
  disclaimer: { fontSize: 11, color: "#aaa", lineHeight: 1.5, textAlign: "center" },
  apiBadgesRow: { display: "flex", gap: 8, marginTop: 24, flexWrap: "wrap", justifyContent: "center", position: "relative", zIndex: 5 },
  apiBadge: { background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)", borderRadius: 20, padding: "4px 12px", fontSize: 11, fontWeight: 600 },
};

// ── APP STYLES ──
const S = {
  root: { display: "flex", height: "100vh", overflow: "hidden", fontFamily: "'Barlow', 'Segoe UI', sans-serif", background: "#f0f0ec" },
  sidebar: { background: "#fff", borderRight: "2px solid #eee", display: "flex", flexDirection: "column", flexShrink: 0, transition: "width 0.2s ease", overflow: "hidden", zIndex: 10 },
  sidebarLogo: { display: "flex", alignItems: "center", gap: 12, padding: "16px 14px", borderBottom: "1px solid #f0f0f0", position: "relative", minHeight: 68 },
  logoIcon: { width: 40, height: 40, background: "#FFCC00", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: "2px solid #111" },
  logoText: { fontWeight: 900, fontSize: 14, letterSpacing: 2, color: "#111", lineHeight: 1, whiteSpace: "nowrap" },
  logoSub: { fontSize: 9, color: "#888", letterSpacing: 1, whiteSpace: "nowrap" },
  collapseBtn: { position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "#f5f5f5", border: "1px solid #eee", borderRadius: 6, width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" },
  sidebarStripe: { height: 5, background: "repeating-linear-gradient(45deg, #FFCC00 0, #FFCC00 8px, #111 8px, #111 16px)", flexShrink: 0 },
  userCard: { display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: "1px solid #f0f0f0", background: "#fafafa" },
  avatarImg: { width: 36, height: 36, borderRadius: "50%", objectFit: "cover", flexShrink: 0, border: "2px solid #FFCC00" },
  avatarFallback: { width: 36, height: 36, background: "#111", color: "#FFCC00", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 16, flexShrink: 0 },
  userName: { fontSize: 13, fontWeight: 700, color: "#111", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  userEmail: { fontSize: 10, color: "#aaa", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  sidebarNav: { flex: 1, padding: "10px 10px", display: "flex", flexDirection: "column", gap: 4, overflowY: "auto" },
  navItem: { width: "100%", border: "none", borderRadius: 10, padding: "11px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, transition: "all 0.15s", position: "relative", fontFamily: "'Barlow', sans-serif" },
  navLabel: { fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", flex: 1, textAlign: "left" },
  navActiveDot: { width: 6, height: 6, borderRadius: "50%", background: "#111" },
  sidebarBottom: { padding: "14px", borderTop: "1px solid #f0f0f0" },
  sidebarBottomTitle: { fontSize: 10, fontWeight: 800, letterSpacing: 1.5, textTransform: "uppercase", color: "#bbb", marginBottom: 8 },
  apiRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 5 },
  apiDot: { width: 7, height: 7, borderRadius: "50%", flexShrink: 0 },
  apiLabel: { fontSize: 11, color: "#666", whiteSpace: "nowrap" },
  logoutBtn: { width: "100%", marginTop: 12, display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 8, background: "#fff", border: "1px solid #eee", borderRadius: 8, padding: "9px 12px", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: "#FF3B30", transition: "all 0.15s" },
  mainArea: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" },
  topbar: { background: "#fff", borderBottom: "2px solid #eee", padding: "0 28px", height: 62, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 },
  pageTitle: { fontWeight: 900, fontSize: 20, color: "#111" },
  breadcrumb: { fontSize: 10, color: "#aaa", letterSpacing: 0.5, textTransform: "uppercase" },
  topbarRight: { display: "flex", alignItems: "center", gap: 12 },
  weatherPill: { background: "#f5f5f5", borderRadius: 30, padding: "6px 14px", display: "flex", alignItems: "center", gap: 8, border: "1px solid #e8e8e8" },
  weatherDivider: { width: 1, height: 16, background: "#ddd" },
  locationPill: { background: "#111", borderRadius: 30, padding: "7px 14px", display: "flex", alignItems: "center", gap: 6, maxWidth: 200 },
  locationPillText: { fontSize: 12, fontWeight: 700, color: "#fff", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" },
  alertBadge: { width: 40, height: 40, background: "#fff5f5", borderRadius: "50%", border: "2px solid #FF3B30", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", cursor: "pointer" },
  badgeCount: { position: "absolute", top: -6, right: -6, background: "#FF3B30", color: "#fff", borderRadius: "50%", width: 18, height: 18, fontSize: 10, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center" },
  badgeCount2: { background: "#FFCC00", color: "#111", borderRadius: 20, padding: "2px 8px", fontSize: 11, fontWeight: 900 },
  content: { flex: 1, overflowY: "auto", padding: "24px 28px" },
  dashGrid: { display: "grid", gridTemplateColumns: "1fr 380px", gap: 20, alignItems: "start" },
  dashLeft: { display: "flex", flexDirection: "column", gap: 20 },
  dashRight: { display: "flex", flexDirection: "column", gap: 20 },
  statRow: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 },
  panelCard: { background: "#fff", borderRadius: 14, border: "1px solid #eee", overflow: "hidden" },
  cardHeader: { display: "flex", alignItems: "center", gap: 8, padding: "14px 18px", borderBottom: "1px solid #f0f0f0", flexWrap: "wrap" },
  cardHeaderText: { fontWeight: 800, fontSize: 14, color: "#111", flex: 1 },
  apiBadge: { background: "#f0f0f0", color: "#888", borderRadius: 6, padding: "3px 7px", fontSize: 10, fontWeight: 700, letterSpacing: 0.5, whiteSpace: "nowrap" },
  viewAllBtn: { background: "none", border: "none", color: "#FFCC00", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" },
  mapPage: { display: "grid", gridTemplateColumns: "1fr 320px", gap: 20, height: "calc(100vh - 112px)" },
  reportPage: { display: "grid", gridTemplateColumns: "1fr 340px", gap: 20, alignItems: "start" },
  communityGrid: { display: "grid", gridTemplateColumns: "1fr 420px", gap: 20, alignItems: "start" },
  typeBtn: { display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s", textAlign: "left" },
  input: { width: "100%", padding: "12px 16px", borderRadius: 10, border: "2px solid #e8e8e8", fontSize: 14, background: "#fff", outline: "none", boxSizing: "border-box", fontFamily: "inherit", transition: "all 0.15s", color: "#111" },
  submitBtn: { width: "100%", background: "#FFCC00", color: "#111", border: "2px solid #111", borderRadius: 12, padding: "16px", fontSize: 15, fontWeight: 900, letterSpacing: 1.5, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, fontFamily: "inherit", transition: "all 0.2s" },
  greenInfoCard: { background: "#34C759", borderRadius: 14, padding: "18px", border: "2px solid #2aa348" },
  greenIconBox: { width: 40, height: 40, background: "rgba(255,255,255,0.2)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center" },
  typePill: { borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 800, letterSpacing: 0.5 },
  deleteBtn: { background: "#fafafa", border: "1px solid #eee", borderRadius: 6, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "background 0.15s" },
  toast: { position: "fixed", bottom: 28, right: 28, color: "#fff", padding: "12px 20px", borderRadius: 12, fontSize: 14, fontWeight: 700, boxShadow: "0 8px 30px rgba(0,0,0,0.2)", zIndex: 9999, display: "flex", alignItems: "center", gap: 8 },
};