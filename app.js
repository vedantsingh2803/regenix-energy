/* REGENIX — Smart Hybrid Energy System Frontend Logic & API Sync */

const state = {
  page: "dashboard",
  live: true,
  animation: true,
  labels: true,
  notifications: true,
  solar: 128,
  wind: 74,
  battery: 72,
  load: 146,
  backendConnected: false,
  historyGen: [82, 91, 104, 119, 128, 142, 154, 167, 182, 195, 202],
  historySoc: [61, 64, 66, 69, 73, 75, 74, 72, 71, 72]
};

const pageTitles = {
  dashboard:"Dashboard", "3d":"3D System", monitoring:"Real-Time Monitoring",
  generation:"Generation", battery:"Battery & BMS", switching:"Hybrid Switching",
  loads:"Load Management", ai:"AI & Optimization", ev:"EV Management",
  alerts:"Faults & Alerts", maintenance:"Maintenance", reports:"Reports",
  carbon:"Carbon Savings", settings:"Settings"
};

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/* Page Navigation */
function go(page){
  if(!page || !pageTitles[page]) return;
  state.page = page;
  $$(".page").forEach(p => p.classList.toggle("active-page", p.dataset.pageContent === page));
  $$(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.page === page));
  window.scrollTo({top:0, behavior:"smooth"});
  
  // Close mobile sidebar if open
  closeMobileSidebar();

  if(page === "3d") setTimeout(()=>resizeRenderer({renderer:detailRenderer,camera:detailCamera}, detailSceneContainer),60);
  if(page === "dashboard") setTimeout(()=>resizeRenderer({renderer:mainRenderer,camera:mainCamera}, mainSceneContainer),60);
  if(page === "3d") setTimeout(updateLabelVisibility,60);
}

document.addEventListener("click", e => {
  const target = e.target.closest("[data-go]");
  if(target){ e.preventDefault(); go(target.dataset.go); }
});
$$(".nav-item").forEach(btn => btn.addEventListener("click", ()=>go(btn.dataset.page)));

/* Toast Alerts */
function toast(message){
  const el=$("#toast");
  if(!el) return;
  el.textContent=message;
  el.classList.add("show");
  clearTimeout(window.__toast);
  window.__toast=setTimeout(()=>el.classList.remove("show"),2600);
}

/* Live Clock */
function updateClock(){
  const now=new Date();
  const t=now.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit", second:"2-digit"});
  const clockEl = $("#clock");
  const updateEl = $("#lastUpdate");
  if(clockEl) clockEl.textContent = t;
  if(updateEl) updateEl.textContent = t;
}
setInterval(updateClock,1000); updateClock();

/* Mobile Sidebar Drawer */
const mobileMenuBtn = $("#mobileMenuBtn");
const sidebarCloseBtn = $("#sidebarCloseBtn");
const sidebarBackdrop = $("#sidebarBackdrop");
const sidebar = $("#sidebar");

function openMobileSidebar(){
  sidebar?.classList.add("open");
  sidebarBackdrop?.classList.add("active");
}
function closeMobileSidebar(){
  sidebar?.classList.remove("open");
  sidebarBackdrop?.classList.remove("active");
}
mobileMenuBtn?.addEventListener("click", openMobileSidebar);
sidebarCloseBtn?.addEventListener("click", closeMobileSidebar);
sidebarBackdrop?.addEventListener("click", closeMobileSidebar);

/* Notification Center Drawer */
const notificationBtn = $("#notificationBtn");
const closeDrawerBtn = $("#closeDrawerBtn");
const notificationDrawer = $("#notificationDrawer");
const drawerOverlay = $("#drawerOverlay");

function openNotificationDrawer(){
  notificationDrawer?.classList.add("open");
  drawerOverlay?.classList.add("open");
  fetchAlerts();
}
function closeNotificationDrawer(){
  notificationDrawer?.classList.remove("open");
  drawerOverlay?.classList.remove("open");
}
notificationBtn?.addEventListener("click", openNotificationDrawer);
closeDrawerBtn?.addEventListener("click", closeNotificationDrawer);
drawerOverlay?.addEventListener("click", closeNotificationDrawer);

/* Interactive Search Dropdown */
const searchInput = $("#searchInput");
const searchDropdown = $("#searchDropdown");

searchInput?.addEventListener("input", e => {
  const q = e.target.value.trim().toLowerCase();
  if(!q){
    searchDropdown.classList.remove("show");
    return;
  }
  const matches = Object.keys(pageTitles).filter(k => pageTitles[k].toLowerCase().includes(q));
  if(matches.length > 0){
    searchDropdown.innerHTML = matches.map(k => `
      <div class="search-item" data-go="${k}">
        <span>${pageTitles[k]}</span>
        <small style="color:#6f8997">Open page →</small>
      </div>
    `).join("");
    searchDropdown.classList.add("show");
  } else {
    searchDropdown.innerHTML = `<div class="search-item" style="color:#6f8997">No matching pages found</div>`;
    searchDropdown.classList.add("show");
  }
});
searchInput?.addEventListener("keydown", e=>{
  if(e.key!=="Enter") return;
  const q=e.target.value.trim().toLowerCase();
  if(!q) return;
  const found=Object.keys(pageTitles).find(k=>pageTitles[k].toLowerCase().includes(q));
  if(found){ go(found); toast(`Opened ${pageTitles[found]}`); searchDropdown.classList.remove("show"); }
  else toast("No matching REGENIX page found.");
});
document.addEventListener("click", e => {
  if(!e.target.closest(".search")) searchDropdown?.classList.remove("show");
});

/* Load Management Relays API Sync */
$$("[data-load]").forEach(btn => {
  btn.addEventListener("click", async () => {
    const loadId = btn.dataset.load;
    const isCurrentlyActive = btn.classList.contains("active");
    const targetState = !isCurrentlyActive;
    
    // UI optimistic update
    btn.classList.toggle("active", targetState);
    btn.textContent = targetState ? "ON" : "OFF";
    
    if(state.backendConnected){
      try {
        await fetch("/api/loads/toggle", {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({load_id: loadId, enabled: targetState})
        });
        toast(`${loadId.toUpperCase()} load relay turned ${targetState ? "ON" : "OFF"}`);
        fetchLiveTelemetry();
      } catch(err) {
        toast(`Load relay updated (Offline simulation)`);
      }
    } else {
      toast(`${loadId.toUpperCase()} load turned ${targetState ? "ON" : "OFF"}`);
    }
  });
});

/* EV Management Mode Selector API Sync */
$$("[data-ev-mode]").forEach(btn => {
  btn.addEventListener("click", async () => {
    const mode = btn.dataset.evMode;
    $$("[data-ev-mode]").forEach(b => b.classList.toggle("active", b === btn));
    
    if(state.backendConnected){
      try {
        await fetch("/api/ev/control", {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({mode})
        });
        toast(`EV charging mode set to: ${mode.toUpperCase()}`);
        fetchLiveTelemetry();
      } catch(err){
        toast(`EV mode set to: ${mode.toUpperCase()}`);
      }
    } else {
      toast(`EV mode set to: ${mode.toUpperCase()}`);
    }
  });
});

/* Fault Injection API Handlers */
async function triggerDemoFault(){
  if(state.backendConnected){
    try {
      await fetch("/api/alerts/trigger", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({type: "OVERLOAD"})
      });
      toast("⚠️ DEMO FAULT INJECTED: Critical System Overload!");
      fetchAlerts();
      fetchLiveTelemetry();
    } catch(err){
      toast("⚠️ Overload fault simulated");
    }
  } else {
    toast("⚠️ Overload fault simulated");
  }
}
$("#triggerFaultBtn")?.addEventListener("click", triggerDemoFault);
$("#drawerTriggerFaultBtn")?.addEventListener("click", triggerDemoFault);

/* Acknowledge Alerts API Handlers */
async function acknowledgeAlerts(){
  if(state.backendConnected){
    try {
      await fetch("/api/alerts/acknowledge", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({})
      });
      toast("✓ All system alerts acknowledged");
      fetchAlerts();
    } catch(err){
      toast("✓ Alerts cleared");
    }
  } else {
    toast("✓ Alerts cleared");
  }
}
$("#ackAlertsBtn")?.addEventListener("click", acknowledgeAlerts);
$("#drawerAckAllBtn")?.addEventListener("click", acknowledgeAlerts);

/* Report Export API Handler */
$("#exportReport")?.addEventListener("click", async () => {
  if(state.backendConnected){
    try {
      const res = await fetch("/api/reports/export", {method:"POST"});
      const json = await res.json();
      if(json.success){
        const blob = new Blob([JSON.stringify(json.report, null, 2)], {type: "application/json"});
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `REGENIX_Report_${Date.now()}.json`;
        a.click();
        $("#reportMessage").textContent = `Report generated and downloaded — Today Gen: ${json.report.today_generation_wh} Wh | Eff: ${json.report.system_efficiency}`;
        toast("System report downloaded successfully.");
      }
    } catch(err){
      $("#reportMessage").textContent = "Demo report generated — Generation 202 Wh | Consumption 146 W | Efficiency 91%.";
      toast("Demo report generated.");
    }
  } else {
    $("#reportMessage").textContent = "Demo report generated — Generation 202 Wh | Consumption 146 W | Efficiency 91%.";
    toast("Demo report generated.");
  }
});

/* Settings Toggles */
$("#liveToggle")?.addEventListener("change", e=>{state.live=e.target.checked;toast(state.live?"Live data enabled":"Live data paused");});
$("#animationToggle")?.addEventListener("change", e=>{state.animation=e.target.checked;});
$("#labelToggle")?.addEventListener("change", e=>{state.labels=e.target.checked;updateLabelVisibility();});
$("#notifToggle")?.addEventListener("change", e=>{state.notifications=e.target.checked;toast(state.notifications?"Notifications enabled":"Notifications muted");});

/* Fetch Alerts List */
async function fetchAlerts(){
  if(!state.backendConnected) return;
  try {
    const res = await fetch("/api/alerts");
    const data = await res.json();
    renderAlertsList(data.alerts || []);
  } catch(err){
    console.error("Alerts fetch error:", err);
  }
}
function renderAlertsList(alerts){
  const badge = $("#notifBadge");
  const drawerBody = $("#drawerAlertList");
  const alertsPageList = $("#alertsPageList");
  
  const unackCount = alerts.filter(a => !a.acknowledged).length;
  if(badge) badge.textContent = unackCount;
  
  if(!alerts || alerts.length === 0){
    const emptyHtml = `<div class="alert good"><span>✓</span><div><b>All Systems Normal</b><small>No active system warnings or faults.</small></div><time>Now</time></div>`;
    if(drawerBody) drawerBody.innerHTML = emptyHtml;
    if(alertsPageList) alertsPageList.innerHTML = emptyHtml;
    return;
  }
  
  const html = alerts.map(a => {
    const icon = a.level === "critical" ? "⚠️" : (a.level === "warning" ? "!" : (a.level === "info" ? "i" : "✓"));
    const cls = a.level;
    return `
      <div class="alert ${cls}">
        <span>${icon}</span>
        <div><b>${a.title}</b><small>${a.message}</small></div>
        <time>${a.time ? a.time.split(" ")[1] || "Now" : "Now"}</time>
      </div>
    `;
  }).join("");
  
  if(drawerBody) drawerBody.innerHTML = html;
  if(alertsPageList) alertsPageList.innerHTML = html;
}

/* =========================================================
   REACTIVE DATA BINDING FOR ALL 14 PAGES
   ========================================================= */
function renderTelemetry(data){
  const solarP = data.solar.power;
  const solarV = data.solar.voltage;
  const solarA = data.solar.current;
  
  const windP = data.wind.power;
  const windV = data.wind.voltage;
  const windA = data.wind.current;
  
  const battSoc = Math.round(data.battery.soc);
  const battV = data.battery.voltage;
  const battA = data.battery.current;
  const battStatus = data.battery.status;
  
  const loadP = data.totals.consumption;
  const genP = data.totals.generation;
  const eff = data.totals.efficiency;
  
  state.solar = solarP;
  state.wind = windP;
  state.battery = battSoc;
  state.load = loadP;

  // 1. DASHBOARD PAGE
  if($("#solarPower")) $("#solarPower").textContent = `${solarP} W`;
  if($("#solarSub")) $("#solarSub").textContent = `${solarV} V • ${solarA} A`;
  
  if($("#windPower")) $("#windPower").textContent = `${windP} W`;
  if($("#windSub")) $("#windSub").textContent = `${windV} V • ${windA} A`;
  
  if($("#batteryPower")) $("#batteryPower").textContent = `${battSoc}%`;
  if($("#batterySub")) $("#batterySub").textContent = `${battV} V • ${battA} A`;
  
  if($("#loadPower")) $("#loadPower").textContent = `${loadP} W`;
  if($("#loadSub")) $("#loadSub").textContent = `230 V • ${roundVal(loadP/230, 2)} A`;
  
  if($("#totalGeneration")) $("#totalGeneration").textContent = `${genP} W`;
  if($("#totalConsumption")) $("#totalConsumption").textContent = `${loadP} W`;
  if($("#dashMetricEff")) $("#dashMetricEff").textContent = `${eff}%`;
  if($("#dashEfficiency")) $("#dashEfficiency").textContent = `${eff}%`;
  if($("#dashEffBar")) $("#dashEffBar").style.width = `${eff}%`;
  
  if($("#solarPct")) $("#solarPct").textContent = `${data.totals.solar_pct}%`;
  if($("#windPct")) $("#windPct").textContent = `${data.totals.wind_pct}%`;
  if($("#batteryPct")) $("#batteryPct").textContent = `${data.totals.battery_pct}%`;

  if(data.loads){
    if($("#dashCritStatus")){
      $("#dashCritStatus").textContent = data.loads.critical?.enabled ? "ON" : "OFF";
      $("#dashCritStatus").className = data.loads.critical?.enabled ? "on" : "muted";
    }
    if($("#dashCritPower")) $("#dashCritPower").textContent = `${data.loads.critical?.power || 0} W`;
    
    if($("#dashImpStatus")){
      $("#dashImpStatus").textContent = data.loads.important?.enabled ? "ON" : "OFF";
      $("#dashImpStatus").className = data.loads.important?.enabled ? "on" : "muted";
    }
    if($("#dashImpPower")) $("#dashImpPower").textContent = `${data.loads.important?.power || 0} W`;
    
    if($("#dashNonCritStatus")){
      $("#dashNonCritStatus").textContent = data.loads.noncritical?.enabled ? "ON" : "OFF";
      $("#dashNonCritStatus").className = data.loads.noncritical?.enabled ? "on" : "muted";
    }
    if($("#dashNonCritPower")) $("#dashNonCritPower").textContent = `${data.loads.noncritical?.power || 0} W`;
  }

  if(data.carbon){
    if($("#dashCarbonKg")) $("#dashCarbonKg").textContent = `${data.carbon.co2_saved_kg}`;
    if($("#dashCarbonTrees")) $("#dashCarbonTrees").textContent = `${data.carbon.trees_equivalent}`;
    if($("#dashCarbonKm")) $("#dashCarbonKm").textContent = `${data.carbon.km_avoided} km`;
  }

  // 2. 3D SYSTEM PAGE
  if($("#3dSolar")) $("#3dSolar").textContent = `${solarP} W`;
  if($("#3dSolarSub")) $("#3dSolarSub").textContent = `${solarV} V • ${solarA} A`;
  if($("#3dWind")) $("#3dWind").textContent = `${windP} W`;
  if($("#3dWindSub")) $("#3dWindSub").textContent = `${windV} V • ${windA} A`;
  if($("#3dBattery")) $("#3dBattery").textContent = `${battSoc}%`;
  if($("#3dBatterySub")) $("#3dBatterySub").textContent = `${battV} V • ${battA} A`;
  if($("#3dLoad")) $("#3dLoad").textContent = `${loadP} W`;
  if($("#3dLoadSub")) $("#3dLoadSub").textContent = `230 V • ${roundVal(loadP/230, 2)} A`;

  // 3. REAL-TIME MONITORING PAGE
  if($("#monSolarV")) $("#monSolarV").textContent = `${solarV} V`;
  if($("#monWindV")) $("#monWindV").textContent = `${windV} V`;
  if($("#monBattA")) $("#monBattA").textContent = `${battA} A`;
  if($("#monBattStatus")) $("#monBattStatus").textContent = battStatus;
  if($("#monLoadP")) $("#monLoadP").textContent = `${loadP} W`;
  
  if($("#monTblSolarV")) $("#monTblSolarV").textContent = `${solarV} V`;
  if($("#monTblSolarA")) $("#monTblSolarA").textContent = `${solarA} A`;
  if($("#monTblSolarP")) $("#monTblSolarP").textContent = `${solarP} W`;
  
  if($("#monTblWindV")) $("#monTblWindV").textContent = `${windV} V`;
  if($("#monTblWindA")) $("#monTblWindA").textContent = `${windA} A`;
  if($("#monTblWindP")) $("#monTblWindP").textContent = `${windP} W`;
  
  if($("#monTblBattV")) $("#monTblBattV").textContent = `${battV} V`;
  if($("#monTblBattA")) $("#monTblBattA").textContent = `${battA} A`;
  if($("#monTblBattP")) $("#monTblBattP").textContent = `${Math.abs(Math.round(battV * battA))} W`;
  if($("#monTblBattSt")) $("#monTblBattSt").textContent = battStatus;
  
  if($("#monTblLoadA")) $("#monTblLoadA").textContent = `${roundVal(loadP/230, 2)} A`;
  if($("#monTblLoadP")) $("#monTblLoadP").textContent = `${loadP} W`;

  // 4. GENERATION PAGE
  if($("#genSolarP")) $("#genSolarP").textContent = `${solarP} W`;
  if($("#genSolarSub")) $("#genSolarSub").textContent = `${solarV} V • ${solarA} A`;
  const solarCapPct = Math.min(100, Math.round(solarP / 1.88));
  if($("#genSolarBar")) $("#genSolarBar").style.width = `${solarCapPct}%`;
  if($("#genSolarCap")) $("#genSolarCap").textContent = `${solarCapPct}% of available solar capacity`;
  
  if($("#genWindP")) $("#genWindP").textContent = `${windP} W`;
  if($("#genWindSub")) $("#genWindSub").textContent = `${windV} V • ${windA} A`;
  const windCapPct = Math.min(100, Math.round(windP / 1.75));
  if($("#genWindBar")) $("#genWindBar").style.width = `${windCapPct}%`;
  if($("#genWindCap")) $("#genWindCap").textContent = `${windCapPct}% of available wind capacity`;

  // 5. BATTERY & BMS PAGE
  if($("#battFill")) $("#battFill").style.height = `${battSoc}%`;
  if($("#battFillText")) $("#battFillText").textContent = `${battSoc}%`;
  if($("#battV")) $("#battV").textContent = `${battV} V`;
  if($("#battA")) $("#battA").textContent = `${battA} A`;
  if($("#battStatusText")) $("#battStatusText").textContent = battStatus;
  if($("#battThreshSoc")) $("#battThreshSoc").textContent = `Battery SoC = ${battSoc}%`;

  if($("#threshRow1")) $("#threshRow1").className = battSoc >= 50 ? "on" : "muted";
  if($("#threshRow2")) $("#threshRow2").className = (battSoc >= 40 && battSoc < 50) ? "on" : "muted";
  if($("#threshRow3")) $("#threshRow3").className = battSoc < 20 ? "on" : "muted";

  // 6. HYBRID SWITCHING PAGE
  if($("#switchSolarP")) $("#switchSolarP").textContent = `${solarP} W`;
  if($("#switchLoadP")) $("#switchLoadP").textContent = `${loadP} W`;
  if($("#switchDecision")){
    if(solarP > windP && genP >= loadP) $("#switchDecision").textContent = "SOLAR PRIORITY";
    else if(windP >= solarP && genP >= loadP) $("#switchDecision").textContent = "WIND PRIORITY";
    else $("#switchDecision").textContent = "BATTERY SUPPORT";
  }

  // 7. LOAD MANAGEMENT PAGE
  if(data.loads){
    if($("#loadsCritPower")) $("#loadsCritPower").textContent = `${data.loads.critical?.power || 0} W`;
    if($("#loadsImpPower")) $("#loadsImpPower").textContent = `${data.loads.important?.power || 0} W`;
    if($("#loadsNonCritPower")) $("#loadsNonCritPower").textContent = `${data.loads.noncritical?.power || 0} W`;
  }

  // 8. AI & OPTIMIZATION PAGE
  if(data.ai){
    if($("#aiForecastP")) $("#aiForecastP").textContent = `${data.ai.forecast_1h} W`;
    if($("#aiRecText")) $("#aiRecText").textContent = data.ai.recommendation;
    if($("#aiRenewablePct")) $("#aiRenewablePct").textContent = `${Math.min(100, Math.round(genP / maxVal(1, loadP) * 100))}%`;
    if($("#aiScoreText")) $("#aiScoreText").textContent = `${data.ai.score} / 100`;
    if($("#aiScoreBar")) $("#aiScoreBar").style.width = `${data.ai.score}%`;
  }

  // 9. EV MANAGEMENT PAGE
  if(data.ev){
    if($("#evChargerPower")) $("#evChargerPower").textContent = `${data.loads.ev?.power || 0} W`;
    if($("#evModeBadge")) $("#evModeBadge").textContent = `MODE: ${data.ev.mode.toUpperCase()}`;
  }

  // 12. REPORTS PAGE
  if($("#repGen")) $("#repGen").textContent = `${genP} Wh`;
  if($("#repCons")) $("#repCons").textContent = `${loadP} Wh`;
  if($("#repEff")) $("#repEff").textContent = `${eff}%`;
  if($("#repCo2") && data.carbon) $("#repCo2").textContent = `${data.carbon.co2_saved_kg} kg`;

  // 13. CARBON SAVINGS PAGE
  if(data.carbon){
    if($("#carbonRingKg")) $("#carbonRingKg").textContent = `${data.carbon.co2_saved_kg}`;
    if($("#carbonTreesCnt")) $("#carbonTreesCnt").textContent = `${data.carbon.trees_equivalent}`;
    if($("#carbonCarKm")) $("#carbonCarKm").textContent = `${data.carbon.km_avoided} km`;
    if($("#carbonWhGen")) $("#carbonWhGen").textContent = `${genP} Wh`;
  }

  update3DLabels();
}

function roundVal(v, decimals=1){
  return Math.round(v * Math.pow(10, decimals)) / Math.pow(10, decimals);
}
function maxVal(a, b){ return Math.max(a, b); }

/* Fetch Live Telemetry API */
async function fetchLiveTelemetry(){
  if(!state.live) return;
  try {
    const res = await fetch("/api/telemetry/live");
    if(res.ok){
      const data = await res.json();
      state.backendConnected = true;
      const connStatus = $("#connectionStatus");
      if(connStatus) connStatus.innerHTML = `<i></i> Server Connected`;
      renderTelemetry(data);
    } else {
      throw new Error("API non-200");
    }
  } catch(err){
    state.backendConnected = false;
    const connStatus = $("#connectionStatus");
    if(connStatus) connStatus.innerHTML = `<i style="background:#ff9800"></i> Offline Simulation`;
    
    // Offline simulation fallback
    simulateOfflineTelemetry();
  }
}

function simulateOfflineTelemetry(){
  state.solar=Math.max(95, Math.round(128 + Math.sin(Date.now()/6500)*18));
  state.wind=Math.max(45, Math.round(74 + Math.sin(Date.now()/4100)*16));
  state.battery=Math.min(100,Math.max(20,Math.round(72 + Math.sin(Date.now()/11000)*3)));
  state.load=Math.max(110,Math.round(146 + Math.sin(Date.now()/5200)*10));
  const generation=state.solar+state.wind;
  const solarPct=Math.round(state.solar/generation*100);
  const windPct=Math.round(state.wind/generation*100);
  const batteryPct=Math.max(0,100-solarPct-windPct);

  renderTelemetry({
    solar: {power: state.solar, voltage: 18.4, current: roundVal(state.solar/18.4, 1)},
    wind: {power: state.wind, voltage: 12.7, current: roundVal(state.wind/12.7, 1)},
    battery: {soc: state.battery, voltage: 12.4, current: -3.2, status: "DISCHARGING"},
    totals: {generation, consumption: state.load, efficiency: 91, solar_pct: solarPct, wind_pct: windPct, battery_pct: batteryPct},
    loads: {
      critical: {power: 72, enabled: true},
      important: {power: 48, enabled: true},
      noncritical: {power: 26, enabled: true},
      ev: {power: 0, enabled: false}
    },
    ev: {mode: "eco"},
    carbon: {co2_saved_kg: 128.6, trees_equivalent: 9, km_avoided: 542},
    ai: {score: 94, forecast_1h: state.load + 12, recommendation: "Use Solar + Wind"}
  });
}

setInterval(fetchLiveTelemetry, 2000);
fetchLiveTelemetry();

/* Fetch Rolling History for Charts */
async function fetchChartHistory(){
  if(!state.backendConnected) return;
  try {
    const res = await fetch("/api/telemetry/history");
    if(res.ok){
      const data = await res.json();
      if(data.generation && data.generation.length > 0) state.historyGen = data.generation;
      if(data.battery_soc && data.battery_soc.length > 0) state.historySoc = data.battery_soc;
      renderCharts();
    }
  } catch(err){}
}
setInterval(fetchChartHistory, 6000);

/* Canvas Line Charts */
function drawLineChart(canvas, values, lineColor, fillColor){
  if(!canvas) return;
  const rect=canvas.getBoundingClientRect(), dpr=window.devicePixelRatio||1;
  const w=Math.max(300,rect.width), h=Math.max(150,rect.height);
  canvas.width=w*dpr; canvas.height=h*dpr;
  const ctx=canvas.getContext("2d"); ctx.scale(dpr,dpr);
  ctx.clearRect(0,0,w,h);
  ctx.strokeStyle="#12303e";ctx.lineWidth=1;
  for(let i=1;i<5;i++){let y=i*h/5;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
  const min=Math.min(...values)-5,max=Math.max(...values)+5;
  const pts=values.map((v,i)=>[i*(w/(values.length-1)),h-((v-min)/(max-min))*h*.72-h*.1]);
  ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.lineTo(w,h);ctx.lineTo(0,h);ctx.closePath();ctx.fillStyle=fillColor;ctx.fill();
  ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.strokeStyle=lineColor;ctx.lineWidth=2;ctx.stroke();
}

function renderCharts(){
  drawLineChart($("#generationChart"), state.historyGen, "#2ee57d", "rgba(46,229,125,.08)");
  drawLineChart($("#batteryChart"), state.historySoc, "#3bbcff", "rgba(59,188,255,.08)");
}
setTimeout(renderCharts,100);
window.addEventListener("resize",renderCharts);

/* =========================================================
   3D DIGITAL TWIN RENDERER & SCENE
   ========================================================= */
const mainSceneContainer=$("#scene");
const detailSceneContainer=$("#sceneDetail");
let mainRenderer=null, detailRenderer=null;
let mainScene=null, detailScene=null;
let mainSystem=null, detailSystem=null;
let mainCamera=null, detailCamera=null;
let mainLabels=[], detailLabels=[];
let mainBlades=null, detailBlades=null;
let mainFlowParticles=[], detailFlowParticles=[];
let dragState={active:false,x:0,y:0,system:null,camera:null,renderer:null};

function makeTextSprite(text,color="#ffffff"){
  const canvas=document.createElement("canvas");
  canvas.width=760; canvas.height=190;
  const ctx=canvas.getContext("2d");
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.font="700 34px Inter, Arial, sans-serif";
  const padX=28, boxW=canvas.width-2*padX, boxH=76, boxY=57;
  ctx.shadowColor=color; ctx.shadowBlur=22;
  ctx.fillStyle="rgba(2,12,18,.88)";
  ctx.beginPath();
  ctx.roundRect(padX,boxY,boxW,boxH,28);
  ctx.fill();
  ctx.shadowBlur=0;
  ctx.strokeStyle=color; ctx.globalAlpha=.42; ctx.lineWidth=2;
  ctx.stroke(); ctx.globalAlpha=1;
  ctx.textAlign="center"; ctx.textBaseline="middle";
  ctx.shadowColor=color; ctx.shadowBlur=14;
  ctx.fillStyle=color; ctx.fillText(text,canvas.width/2,boxY+boxH/2+1);
  const tex=new THREE.CanvasTexture(canvas);
  tex.colorSpace=THREE.SRGBColorSpace;
  tex.anisotropy=4;
  const mat=new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false,depthWrite:false});
  const sprite=new THREE.Sprite(mat);
  sprite.scale.set(3.35,.84,1);
  sprite.userData.baseText=text;
  return sprite;
}
function label(group,text,color,pos,collection){
  const s=makeTextSprite(text,color);
  s.position.set(...pos);
  group.add(s); collection.push(s);
  return s;
}
function updateSprite(sprite,text,color){
  const canvas=document.createElement("canvas"); canvas.width=760; canvas.height=190;
  const ctx=canvas.getContext("2d");
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.font="700 34px Inter, Arial, sans-serif";
  const padX=28, boxW=canvas.width-2*padX, boxH=76, boxY=57;
  ctx.shadowColor=color; ctx.shadowBlur=22;
  ctx.fillStyle="rgba(2,12,18,.88)";
  ctx.beginPath(); ctx.roundRect(padX,boxY,boxW,boxH,28); ctx.fill();
  ctx.shadowBlur=0; ctx.strokeStyle=color; ctx.globalAlpha=.42; ctx.lineWidth=2; ctx.stroke(); ctx.globalAlpha=1;
  ctx.textAlign="center"; ctx.textBaseline="middle";
  ctx.shadowColor=color; ctx.shadowBlur=14; ctx.fillStyle=color; ctx.fillText(text,canvas.width/2,boxY+boxH/2+1);
  sprite.material.map.dispose();
  sprite.material.map=new THREE.CanvasTexture(canvas);
  sprite.material.map.colorSpace=THREE.SRGBColorSpace;
  sprite.material.map.anisotropy=4;
  sprite.material.needsUpdate=true;
  sprite.userData.baseText=text;
}
function makeBox(w,h,d,mat){
  const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
  m.castShadow=true;m.receiveShadow=true;return m;
}

function buildSystem(scene, labels){
  const root=new THREE.Group();
  const flowParticles=[];
  root.rotation.x=-0.28;root.rotation.y=-0.45;scene.add(root);

  const dark=new THREE.MeshStandardMaterial({color:0x172833,metalness:.7,roughness:.28});
  const dark2=new THREE.MeshStandardMaterial({color:0x0c1720,metalness:.55,roughness:.35});
  const green=new THREE.MeshStandardMaterial({color:0x18d568,emissive:0x063b1b,emissiveIntensity:.55});
  const blue=new THREE.MeshStandardMaterial({color:0x1679c7,emissive:0x06294a,emissiveIntensity:.45});
  const cyan=new THREE.MeshStandardMaterial({color:0x21b9f5,emissive:0x063c54,emissiveIntensity:.35});
  const yellow=new THREE.MeshStandardMaterial({color:0xffc51f,emissive:0x513600,emissiveIntensity:.5});
  const white=new THREE.MeshStandardMaterial({color:0xdfe9ee,metalness:.5,roughness:.25});
  const red=new THREE.MeshStandardMaterial({color:0xdc4350,emissive:0x3a080c,emissiveIntensity:.35});

  const platform=makeBox(12,.5,7,dark2);platform.position.y=-1;root.add(platform);
  const floor=makeBox(11.5,.1,6.5,new THREE.MeshStandardMaterial({color:0x0d3020}));floor.position.y=-.69;root.add(floor);

  const grid=new THREE.GridHelper(11,16,0x1c6543,0x103a2a);grid.position.y=-.62;root.add(grid);
  const edgeMat=new THREE.MeshBasicMaterial({color:0x18d568,transparent:true,opacity:.62});
  const edge=makeBox(11.6,.035,6.6,edgeMat); edge.position.y=-.57; root.add(edge);
  const cornerLights=[];
  [[-5.6,-3.05],[5.6,-3.05],[-5.6,3.05],[5.6,3.05]].forEach(([x,z])=>{
    const lamp=new THREE.Mesh(new THREE.SphereGeometry(.09,12,12),new THREE.MeshBasicMaterial({color:0x3dff9a}));
    lamp.position.set(x,-.48,z); root.add(lamp); cornerLights.push(lamp);
  });

  // Solar array
  const solar=new THREE.Group();solar.position.set(-3.4,0,0);root.add(solar);
  for(let i=0;i<6;i++){
    const p=makeBox(1.2,.08,.8,blue);const col=i%3,row=Math.floor(i/3);
    p.position.set(col*1.25-1.25,.75,row*.9-.45);p.rotation.x=-.25;solar.add(p);
    const line=makeBox(1.18,.018,.025,cyan);line.position.copy(p.position);line.position.y+=.055;solar.add(line);
  }
  const sStand=makeBox(.3,1.4,.3,dark);sStand.position.set(0,0,0);solar.add(sStand);
  const solarFrame=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(3.95,.11,2.05)),new THREE.LineBasicMaterial({color:0x2abfff,transparent:true,opacity:.7}));
  solarFrame.position.set(0,.78,0); solar.add(solarFrame);
  label(solar,"☀ SOLAR 128 W","#ffd21f",[0,1.75,0],labels);

  // Hybrid controller
  const inverter=makeBox(2.25,1.15,1.55,dark);inverter.position.set(0,-.05,0);root.add(inverter);
  const screen=makeBox(.75,.32,.05,green);screen.position.set(0,.13,-.8);inverter.add(screen);
  const ventMat=new THREE.MeshStandardMaterial({color:0x405560});
  for(let i=-2;i<=2;i++){const v=makeBox(.08,.35,.03,ventMat);v.position.set(i*.18,-.35,-.81);inverter.add(v);}
  label(inverter,"⚡ HYBRID CONTROLLER","#ffffff",[0,1.05,0],labels);

  // Battery
  const batterySystem=new THREE.Group();batterySystem.position.set(0,0,0);root.add(batterySystem);
  const battery=new THREE.Mesh(new THREE.CylinderGeometry(.78,.78,1.9,40),green);battery.position.set(0,.65,0);batterySystem.add(battery);
  const top=new THREE.Mesh(new THREE.CylinderGeometry(.63,.63,.14,32),dark);top.position.set(0,1.64,0);batterySystem.add(top);
  const terminal=makeBox(.22,.18,.22,white);terminal.position.set(0,1.78,0);batterySystem.add(terminal);
  const batteryRing=new THREE.Mesh(new THREE.TorusGeometry(.88,.045,10,48),new THREE.MeshBasicMaterial({color:0x39ef84,transparent:true,opacity:.8}));
  batteryRing.rotation.x=Math.PI/2; batteryRing.position.set(0,-.28,0); batterySystem.add(batteryRing);
  label(batterySystem,"▣ BATTERY + BMS 72%","#42ef83",[0,2.35,0],labels);

  // Wind turbine
  const turbine=new THREE.Group();turbine.position.set(3.1,0,0);root.add(turbine);
  const tower=new THREE.Mesh(new THREE.CylinderGeometry(.12,.25,4.4,24),white);tower.position.y=1.35;tower.castShadow=true;turbine.add(tower);
  const nacelle=makeBox(.75,.48,1.0,white);nacelle.position.set(0,3.55,-.12);turbine.add(nacelle);

  const hub=new THREE.Mesh(new THREE.SphereGeometry(.27,24,24),white);hub.position.set(0,3.55,-.67);turbine.add(hub);
  const hubRing=new THREE.Mesh(new THREE.TorusGeometry(.34,.045,10,36),new THREE.MeshBasicMaterial({color:0x35bfff,transparent:true,opacity:.8}));
  hubRing.rotation.x=Math.PI/2; hubRing.position.set(0,3.55,-.69); turbine.add(hubRing);
  const blades=new THREE.Group();blades.position.set(0,3.55,-.70);turbine.add(blades);
  const bladeMat=new THREE.MeshStandardMaterial({color:0xf2f7f9,metalness:.35,roughness:.3});
  for(let i=0;i<3;i++){
    const bg=new THREE.Group();bg.rotation.z=i*Math.PI*2/3;
    const blade=makeBox(.16,1.8,.12,bladeMat);blade.position.y=.9;blade.rotation.z=.08;bg.add(blade);
    const tip=makeBox(.24,.34,.14,bladeMat);tip.position.y=1.78;tip.rotation.z=-.12;bg.add(tip);
    blades.add(bg);
  }
  label(turbine,"♨ WIND 74 W","#38bfff",[0,4.55,0],labels);

  // Grid tower
  const gridGroup=new THREE.Group();gridGroup.position.set(4.7,-.55,0);root.add(gridGroup);
  for(let i=0;i<3;i++){const leg=makeBox(.08,3,.08,new THREE.MeshStandardMaterial({color:0x6c7d85,metalness:.8}));leg.position.set((i-1)*.5,1,0);gridGroup.add(leg);}
  const cross=makeBox(1.3,.08,.08,white);cross.position.y=2.2;gridGroup.add(cross);
  label(gridGroup,"⚡ GRID","#c9d8de",[0,3.0,0],labels);

  // Loads
  const loads=[[-3.4,-1.8,red,"CRITICAL LOADS","#ff6670",1.25],[0,-1.8,yellow,"IMPORTANT LOADS","#ffd21f",1.05],[3.4,-1.8,cyan,"NON-CRITICAL LOADS","#38bfff",.85]];
  loads.forEach(([x,z,mat,text,col,h])=>{
    const b=new THREE.Group();b.position.set(x,0,z);root.add(b);
    const body=makeBox(1.65,h,1.2,mat);body.position.y=-.25;b.add(body);
    const roof=makeBox(1.35,.22,1.0,white);roof.position.y=h/2-.05;b.add(roof);
    label(b,text,col,[0,h/2+.55,0],labels);
  });

  // Energy cables
  function cable(a,b,color){
    const mid=new THREE.Vector3((a[0]+b[0])/2,a[1]+.5,(a[2]+b[2])/2);
    const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(...a),mid,new THREE.Vector3(...b)]);
    const geo=new THREE.TubeGeometry(curve,35,.055,8,false);
    root.add(new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color})));
  }
  function addFlowParticles(a,b,color,count=5){
    for(let i=0;i<count;i++){
      const mesh=new THREE.Mesh(new THREE.SphereGeometry(.07,10,10),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.95}));
      mesh.userData.a=new THREE.Vector3(...a); mesh.userData.b=new THREE.Vector3(...b); mesh.userData.t=i/count; mesh.userData.speed=.0025+Math.random()*.0015;
      root.add(mesh); flowParticles.push(mesh);
    }
  }

  cable([-3.0,.7,0],[-1.0,.1,0],0xffc51f);
  cable([2.8,.8,0],[1.0,.1,0],0x35baff);
  cable([0,.15,0],[-2.8,.05,-1.8],0x32ed82);
  cable([0,.15,0],[0,.05,-1.8],0x32ed82);
  cable([0,.15,0],[2.8,.05,-1.8],0x32ed82);
  addFlowParticles([-3.0,.7,0],[-1.0,.1,0],0xffc51f,6);
  addFlowParticles([2.8,.8,0],[1.0,.1,0],0x35baff,5);
  addFlowParticles([0,.15,0],[-2.8,.05,-1.8],0x32ed82,5);
  addFlowParticles([0,.15,0],[0,.05,-1.8],0x32ed82,5);
  addFlowParticles([0,.15,0],[2.8,.05,-1.8],0x32ed82,5);

  return {root,blades,labels,flowParticles,cornerLights,batteryRing,hubRing};
}

function createRenderer(container){
  if(!container || typeof THREE==="undefined") return null;
  const scene=new THREE.Scene();
  scene.background=new THREE.Color(0x010a11);
  const camera=new THREE.PerspectiveCamera(45,1,.1,100);
  camera.position.set(0,7.3,15);camera.lookAt(0,.5,0);

  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  container.innerHTML="";
  container.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xaadfff,0x061018,1.8));
  const key=new THREE.DirectionalLight(0xffffff,3.4);key.position.set(5,10,8);key.castShadow=true;scene.add(key);
  const greenLight=new THREE.PointLight(0x00ff72,4,18);greenLight.position.set(0,3,0);scene.add(greenLight);
  const blueLight=new THREE.PointLight(0x008cff,2.5,14);blueLight.position.set(-4,3,3);scene.add(blueLight);

  const labels=[];
  const system=buildSystem(scene,labels);
  resizeRenderer({renderer,camera},container);

  return {scene,camera,renderer,system,labels,container};
}
function resizeRenderer(obj,container,cameraOverride){
  if(!obj || !container || !obj.renderer) return;
  const camera=cameraOverride||obj.camera;
  const w=Math.max(1,container.clientWidth),h=Math.max(1,container.clientHeight);
  camera.aspect=w/h;
  camera.updateProjectionMatrix();
  obj.renderer.setSize(w,h,false);
}

if(typeof THREE==="undefined"){
  [mainSceneContainer,detailSceneContainer].forEach(c=>{if(c)c.innerHTML='<div style="display:grid;place-items:center;height:100%;color:#ff6b6b;font:600 13px Inter;padding:20px;text-align:center">3D engine could not load.<br>Please run the project with an internet connection so the Three.js CDN can load.</div>';});
}else{
  const mainObj=createRenderer(mainSceneContainer);
  mainScene=mainObj.scene;mainCamera=mainObj.camera;mainRenderer=mainObj.renderer;mainSystem=mainObj.system.root;mainBlades=mainObj.system.blades;mainLabels=mainObj.labels;mainFlowParticles=mainObj.system.flowParticles;
  const detailObj=createRenderer(detailSceneContainer);
  detailScene=detailObj.scene;detailCamera=detailObj.camera;detailRenderer=detailObj.renderer;detailSystem=detailObj.system.root;detailBlades=detailObj.system.blades;detailLabels=detailObj.labels;detailFlowParticles=detailObj.system.flowParticles;

  function attachControls(obj){
    const c=obj.container;
    c.addEventListener("pointerdown",e=>{
      dragState={active:true,x:e.clientX,y:e.clientY,system:obj.system.root,camera:obj.camera,renderer:obj.renderer};
      c.setPointerCapture?.(e.pointerId);
    });
    c.addEventListener("pointermove",e=>{
      if(!dragState.active || dragState.system!==obj.system.root) return;
      const dx=e.clientX-dragState.x,dy=e.clientY-dragState.y;
      obj.system.root.rotation.y += dx*.008;
      obj.system.root.rotation.x += dy*.004;
      obj.system.root.rotation.x=Math.max(-1.0,Math.min(.4,obj.system.root.rotation.x));
      dragState.x=e.clientX;dragState.y=e.clientY;
    });
    c.addEventListener("pointerup",()=>dragState.active=false);
    c.addEventListener("pointerleave",()=>dragState.active=false);
    c.addEventListener("wheel",e=>{
      e.preventDefault();
      obj.camera.position.z=Math.max(9,Math.min(24,obj.camera.position.z+e.deltaY*.012));
    },{passive:false});
  }
  attachControls(mainObj);attachControls(detailObj);

  function animate(){
    requestAnimationFrame(animate);
    if(state.animation){
      if(mainBlades) mainBlades.rotation.z-=.018;
      if(detailBlades) detailBlades.rotation.z-=.018;
      [mainFlowParticles,detailFlowParticles].forEach(list=>list.forEach(p=>{
        p.userData.t=(p.userData.t+p.userData.speed)%1;
        p.position.lerpVectors(p.userData.a,p.userData.b,p.userData.t);
        p.position.y += Math.sin(p.userData.t*Math.PI)*.22;
      }));
    }
    if(state.labels){
      mainLabels.forEach(l=>l.quaternion.copy(mainCamera.quaternion));
      detailLabels.forEach(l=>l.quaternion.copy(detailCamera.quaternion));
    }
    if(mainRenderer && mainScene && mainCamera) mainRenderer.render(mainScene,mainCamera);
    if(detailRenderer && detailScene && detailCamera) detailRenderer.render(detailScene,detailCamera);
  }
  animate();
  window.addEventListener("resize",()=>{
    resizeRenderer(mainObj, mainSceneContainer);
    resizeRenderer(detailObj, detailSceneContainer);
  });
}

function update3DLabels(){
  const solarText=`☀ SOLAR ${state.solar} W`;
  const windText=`♨ WIND ${state.wind} W`;
  const battText=`▣ BATTERY + BMS ${state.battery}%`;
  [mainLabels,detailLabels].forEach(list=>{
    if(list.length>=8){
      updateSprite(list[0],solarText,"#ffd21f");
      updateSprite(list[2],battText,"#42ef83");
      updateSprite(list[3],windText,"#38bfff");
    }
  });
}
function updateLabelVisibility(){
  [...mainLabels,...detailLabels].forEach(l=>l.visible=state.labels);
}
