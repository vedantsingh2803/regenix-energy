import http.server
import socketserver
import json
import sqlite3
import time
import math
import random
import os
import sys
import threading
from urllib.parse import parse_qs, urlparse

PORT = int(os.environ.get("PORT", 8000))
DB_FILE = os.path.join(os.path.dirname(__file__), "regenix.db")
WEB_DIR = os.path.dirname(__file__)

# Global state in memory for fast telemetry computations
class MicrogridState:
    def __init__(self):
        self.lock = threading.Lock()
        self.solar_voltage = 18.4
        self.solar_current = 6.95
        self.solar_power = 128
        
        self.wind_voltage = 12.7
        self.wind_current = 5.83
        self.wind_power = 74
        
        self.battery_soc = 72.0
        self.battery_voltage = 12.4
        self.battery_current = -3.2
        self.battery_temp = 28.5
        self.battery_status = "DISCHARGING"
        
        self.grid_voltage = 230.0
        self.grid_power = 0
        self.grid_status = "STANDBY"
        
        # Load relays
        self.loads = {
            "critical": {"power": 72, "enabled": True, "name": "Critical Loads"},
            "important": {"power": 48, "enabled": True, "name": "Important Loads"},
            "noncritical": {"power": 26, "enabled": True, "name": "Non-Critical Loads"},
            "ev": {"power": 0, "enabled": False, "name": "EV Charger"}
        }
        
        self.ev_mode = "eco" # "eco", "fast", "off"
        self.ev_power_kw = 3.2
        
        self.frequency = 50.02
        self.efficiency = 91.0
        
        # Historical buffer for live charts (last 20 points)
        self.history_gen = [82, 91, 104, 119, 128, 142, 154, 167, 182, 195, 202]
        self.history_soc = [61, 64, 66, 69, 73, 75, 74, 72, 71, 72]
        
        self.carbon_co2_kg = 128.6
        self.today_wh = 202

        self.active_fault = None # e.g. "OVERLOAD"

state = MicrogridState()

def init_db():
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS telemetry_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            solar_power REAL,
            wind_power REAL,
            battery_soc REAL,
            total_consumption REAL,
            efficiency REAL
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            level TEXT,
            title TEXT,
            message TEXT,
            acknowledged INTEGER DEFAULT 0
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    ''')

    # Seed initial alerts if empty
    cursor.execute("SELECT COUNT(*) FROM alerts")
    if cursor.fetchone()[0] == 0:
        cursor.execute("INSERT INTO alerts (level, title, message, acknowledged) VALUES (?, ?, ?, ?)",
                       ("good", "System Normal", "All monitored energy sources are operating within expected limits.", 0))
        cursor.execute("INSERT INTO alerts (level, title, message, acknowledged) VALUES (?, ?, ?, ?)",
                       ("info", "Battery Support Ready", "Battery reserve is available for renewable fluctuations.", 0))
        cursor.execute("INSERT INTO alerts (level, title, message, acknowledged) VALUES (?, ?, ?, ?)",
                       ("good", "BMS Protection Active", "Voltage and current protection are enabled.", 0))

    conn.commit()
    conn.close()

def telemetry_loop():
    """Background physics loop simulating live solar/wind/battery microgrid telemetry."""
    step = 0
    while True:
        time.sleep(2)
        step += 1
        with state.lock:
            # Solar fluctuates with daylight sine curve
            solar_var = math.sin(time.time() / 6.5) * 18
            state.solar_power = max(80, int(128 + solar_var))
            state.solar_voltage = round(18.0 + (state.solar_power / 128.0) * 0.8, 1)
            state.solar_current = round(state.solar_power / max(1, state.solar_voltage), 2)
            
            # Wind fluctuates with wind turbulence
            wind_var = math.sin(time.time() / 4.1) * 16
            state.wind_power = max(40, int(74 + wind_var))
            state.wind_voltage = round(12.2 + (state.wind_power / 74.0) * 0.7, 1)
            state.wind_current = round(state.wind_power / max(1, state.wind_voltage), 2)
            
            # Total generation
            gen = state.solar_power + state.wind_power
            
            # Calculate load power based on active relays
            load_sum = 0
            if state.loads["critical"]["enabled"]: load_sum += state.loads["critical"]["power"]
            if state.loads["important"]["enabled"]: load_sum += state.loads["important"]["power"]
            if state.loads["noncritical"]["enabled"]: load_sum += state.loads["noncritical"]["power"]
            
            # EV charger load calculation
            if state.loads["ev"]["enabled"]:
                if state.ev_mode == "fast":
                    state.loads["ev"]["power"] = 3200
                elif state.ev_mode == "eco":
                    # Eco mode uses excess renewable generation
                    excess = max(0, gen - (load_sum - state.loads["ev"]["power"]))
                    state.loads["ev"]["power"] = min(3200, max(500, excess))
                else:
                    state.loads["ev"]["power"] = 0
            else:
                state.loads["ev"]["power"] = 0

            load_sum += state.loads["ev"]["power"]
            
            # Simulated fault injection
            if state.active_fault == "OVERLOAD":
                load_sum += 1500

            # Net power diff
            net = gen - load_sum
            
            # Battery SoC dynamics
            if net < 0:
                # Discharging
                drain_rate = abs(net) / 3600.0 * 0.05
                state.battery_soc = max(15.0, round(state.battery_soc - drain_rate, 2))
                state.battery_current = round(-abs(net) / max(1, state.battery_voltage), 2)
                state.battery_status = "DISCHARGING"
            else:
                # Charging
                charge_rate = net / 3600.0 * 0.04
                state.battery_soc = min(100.0, round(state.battery_soc + charge_rate, 2))
                state.battery_current = round(net / max(1, state.battery_voltage), 2)
                state.battery_status = "CHARGING" if net > 5 else "STANDBY"
            
            # Grid backup logic if SoC low or heavy overload
            if state.battery_soc < 20 or state.active_fault == "OVERLOAD":
                state.grid_power = max(0, load_sum - gen)
                state.grid_status = "ACTIVE"
            else:
                state.grid_power = 0
                state.grid_status = "STANDBY"

            # Efficiency calculation
            eff_base = 92.0 - (state.loads["ev"]["power"] / 3200.0) * 3.0
            state.efficiency = round(max(82.0, min(97.0, eff_base + math.sin(step / 10.0))), 1)
            
            # Update history rolling buffers
            if step % 3 == 0:
                state.history_gen.append(gen)
                if len(state.history_gen) > 20: state.history_gen.pop(0)
                
                state.history_soc.append(int(state.battery_soc))
                if len(state.history_soc) > 20: state.history_soc.pop(0)

                # Periodically log to SQLite DB
                try:
                    conn = sqlite3.connect(DB_FILE)
                    c = conn.cursor()
                    c.execute("INSERT INTO telemetry_logs (solar_power, wind_power, battery_soc, total_consumption, efficiency) VALUES (?, ?, ?, ?, ?)",
                              (state.solar_power, state.wind_power, state.battery_soc, load_sum, state.efficiency))
                    conn.commit()
                    conn.close()
                except Exception:
                    pass

class RegenixRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def _set_json_headers(self, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_OPTIONS(self):
        self._set_json_headers(200)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/telemetry/live":
            self._set_json_headers(200)
            with state.lock:
                gen = state.solar_power + state.wind_power
                cons = sum(l["power"] for l in state.loads.values() if l["enabled"])
                solar_pct = round(state.solar_power / max(1, gen) * 100)
                wind_pct = round(state.wind_power / max(1, gen) * 100)
                batt_pct = max(0, 100 - solar_pct - wind_pct)

                data = {
                    "solar": {"voltage": state.solar_voltage, "current": state.solar_current, "power": state.solar_power},
                    "wind": {"voltage": state.wind_voltage, "current": state.wind_current, "power": state.wind_power},
                    "battery": {
                        "soc": state.battery_soc,
                        "voltage": state.battery_voltage,
                        "current": state.battery_current,
                        "status": state.battery_status,
                        "temp": state.battery_temp
                    },
                    "grid": {"voltage": state.grid_voltage, "power": state.grid_power, "status": state.grid_status},
                    "loads": state.loads,
                    "ev": {"mode": state.ev_mode, "power_kw": state.ev_power_kw, "active": state.loads["ev"]["enabled"]},
                    "totals": {
                        "generation": gen,
                        "consumption": cons,
                        "efficiency": state.efficiency,
                        "frequency": state.frequency,
                        "solar_pct": solar_pct,
                        "wind_pct": wind_pct,
                        "battery_pct": batt_pct
                    },
                    "carbon": {
                        "today_wh": gen,
                        "co2_saved_kg": round(128.6 + (gen / 1000.0) * 0.85, 1),
                        "trees_equivalent": int(9 + (gen / 500.0)),
                        "km_avoided": int(542 + (gen / 10.0))
                    },
                    "ai": {
                        "score": 94 if state.battery_soc >= 40 else 78,
                        "forecast_1h": cons + 12,
                        "recommendation": "Use Solar + Wind" if gen > cons else "Battery Support Active",
                        "battery_reserve_ok": state.battery_soc >= 20
                    },
                    "active_fault": state.active_fault
                }
            self.wfile.write(json.dumps(data).encode("utf-8"))
            return

        elif path == "/api/telemetry/history":
            self._set_json_headers(200)
            with state.lock:
                data = {
                    "generation": list(state.history_gen),
                    "battery_soc": list(state.history_soc)
                }
            self.wfile.write(json.dumps(data).encode("utf-8"))
            return

        elif path == "/api/alerts":
            self._set_json_headers(200)
            try:
                conn = sqlite3.connect(DB_FILE)
                c = conn.cursor()
                c.execute("SELECT id, timestamp, level, title, message, acknowledged FROM alerts ORDER BY id DESC LIMIT 15")
                rows = c.fetchall()
                conn.close()
                alerts = [{
                    "id": r[0], "time": r[1], "level": r[2], "title": r[3], "message": r[4], "acknowledged": bool(r[5])
                } for r in rows]
            except Exception as e:
                alerts = []
            self.wfile.write(json.dumps({"alerts": alerts}).encode("utf-8"))
            return

        elif path == "/api/ai/forecast":
            self._set_json_headers(200)
            with state.lock:
                cons = sum(l["power"] for l in state.loads.values() if l["enabled"])
                forecast = [int(cons * (1 + math.sin(i / 2.0) * 0.15)) for i in range(6)]
                res = {
                    "next_1h": forecast[0],
                    "forecast_bars": forecast,
                    "score": 94 if state.battery_soc > 40 else 76,
                    "recommendation": "Use Solar + Wind priority routing.",
                    "renewable_contrib_pct": min(100, int((state.solar_power + state.wind_power) / max(1, cons) * 100))
                }
            self.wfile.write(json.dumps(res).encode("utf-8"))
            return

        # Serve static files as default behavior
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length) if content_length > 0 else b'{}'
        try:
            req_data = json.loads(body.decode('utf-8'))
        except Exception:
            req_data = {}

        if path == "/api/loads/toggle":
            load_id = req_data.get("load_id")
            enabled = req_data.get("enabled")
            if load_id in state.loads:
                with state.lock:
                    if enabled is not None:
                        state.loads[load_id]["enabled"] = bool(enabled)
                    else:
                        state.loads[load_id]["enabled"] = not state.loads[load_id]["enabled"]
            
            self._set_json_headers(200)
            self.wfile.write(json.dumps({"success": True, "loads": state.loads}).encode("utf-8"))
            return

        elif path == "/api/ev/control":
            mode = req_data.get("mode")
            power_kw = req_data.get("power_kw")
            with state.lock:
                if mode in ["eco", "fast", "off"]:
                    state.ev_mode = mode
                    state.loads["ev"]["enabled"] = (mode != "off")
                if power_kw is not None:
                    state.ev_power_kw = float(power_kw)

            self._set_json_headers(200)
            self.wfile.write(json.dumps({
                "success": True,
                "ev_mode": state.ev_mode,
                "ev_power_kw": state.ev_power_kw,
                "ev_enabled": state.loads["ev"]["enabled"]
            }).encode("utf-8"))
            return

        elif path == "/api/alerts/acknowledge":
            alert_id = req_data.get("id")
            try:
                conn = sqlite3.connect(DB_FILE)
                c = conn.cursor()
                if alert_id:
                    c.execute("UPDATE alerts SET acknowledged = 1 WHERE id = ?", (alert_id,))
                else:
                    c.execute("UPDATE alerts SET acknowledged = 1")
                conn.commit()
                conn.close()
            except Exception:
                pass

            self._set_json_headers(200)
            self.wfile.write(json.dumps({"success": True}).encode("utf-8"))
            return

        elif path == "/api/alerts/trigger":
            fault_type = req_data.get("type", "OVERLOAD")
            with state.lock:
                state.active_fault = fault_type
            
            try:
                conn = sqlite3.connect(DB_FILE)
                c = conn.cursor()
                c.execute("INSERT INTO alerts (level, title, message, acknowledged) VALUES (?, ?, ?, ?)",
                          ("critical", "CRITICAL OVERLOAD TRIP", "System load exceeded 1.5 kW safety limit! Dynamic load shedding triggered.", 0))
                conn.commit()
                conn.close()
            except Exception:
                pass

            self._set_json_headers(200)
            self.wfile.write(json.dumps({"success": True, "fault": fault_type}).encode("utf-8"))
            return

        elif path == "/api/reports/export":
            with state.lock:
                report_data = {
                    "system": "REGENIX Smart Hybrid Microgrid",
                    "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "today_generation_wh": state.solar_power + state.wind_power,
                    "today_consumption_wh": sum(l["power"] for l in state.loads.values() if l["enabled"]),
                    "system_efficiency": f"{state.efficiency}%",
                    "battery_soc": f"{state.battery_soc}%",
                    "co2_saved_kg": round(128.6 + (state.solar_power / 100.0), 1),
                    "status": "ALL SYSTEMS NORMAL"
                }
            self._set_json_headers(200)
            self.wfile.write(json.dumps({"success": True, "report": report_data}).encode("utf-8"))
            return

        self._set_json_headers(404)
        self.wfile.write(json.dumps({"error": "Endpoint not found"}).encode("utf-8"))

class ThreadedHTTPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True

def run():
    init_db()
    t = threading.Thread(target=telemetry_loop, daemon=True)
    t.start()
    
    server = ThreadedHTTPServer(("0.0.0.0", PORT), RegenixRequestHandler)
    print(f"[REGENIX] Smart Hybrid Energy Server running on http://localhost:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down REGENIX server.")
        server.shutdown()

if __name__ == "__main__":
    run()
