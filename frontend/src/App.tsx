import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  CircleDot,
  Clock3,
  RefreshCw,
  Server,
  ShieldAlert,
  Zap,
} from 'lucide-react';
import './App.css';

const API = (
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'
).replace(/\/$/, '');

type Incident = {
  id: number | string;
  service_name: string;
  title: string;
  description?: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'OPEN' | 'INVESTIGATING' | 'RESOLVED';
  detected_at: string;
  resolved_at?: string | null;
};

type Metric = {
  id: number | string;
  service_name: string;
  metric_name: string;
  value: number;
  recorded_at: string;
};

type Service = {
  id: number | string;
  name: string;
};

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || `Request failed (${response.status})`);
  }

  return response.json() as Promise<T>;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Unknown'
    : date.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}

function formatMetricName(name: string) {
  return name.replaceAll('_', ' ');
}

function App() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [filter, setFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | number | null>(null);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const refresh = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    else setRefreshing(true);

    try {
      const [incidentData, metricData, serviceData] = await Promise.all([
        api<{ incidents: Incident[] }>('/api/incidents?limit=100'),
        api<{ metrics: Metric[] }>('/api/metrics?limit=10'),
        api<{ services?: Service[] } | Service[]>('/api/services'),
      ]);

      setIncidents(incidentData.incidents ?? []);
      setMetrics(metricData.metrics ?? []);

      const serviceList = Array.isArray(serviceData)
        ? serviceData
        : serviceData.services ?? [];

      setServices(serviceList);
      setError('');
      setLastUpdated(new Date());
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to connect to the TraceLens API.',
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh(true);

    const timer = window.setInterval(() => {
      void refresh();
    }, 15000);

    return () => window.clearInterval(timer);
  }, [refresh]);

  async function updateStatus(
    incident: Incident,
    status: 'INVESTIGATING' | 'RESOLVED',
  ) {
    setUpdatingId(incident.id);
    setError('');

    try {
      await api(`/api/incidents/${incident.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });

      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not update incident.',
      );
    } finally {
      setUpdatingId(null);
    }
  }

  const activeIncidents = incidents.filter(
    (incident) => incident.status !== 'RESOLVED',
  );

  const criticalIncidents = activeIncidents.filter(
    (incident) => incident.severity === 'CRITICAL',
  );

  const filteredIncidents = incidents.filter((incident) => {
    if (filter === 'ALL') return true;
    if (filter === 'ACTIVE') return incident.status !== 'RESOLVED';
    return incident.severity === filter;
  });

  const investigatingCount = activeIncidents.filter(
    (incident) => incident.status === 'INVESTIGATING',
  ).length;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="TraceLens home">
          <span className="brand-icon"><Activity size={23} /></span>
          <span>Trace<span className="brand-accent">Lens</span></span>
        </a>

        <div className="workspace-label">WORKSPACE</div>

        <nav className="navigation">
          <a className="nav-item selected" href="#overview">
            <Activity size={18} />
            Overview
          </a>
          <a className="nav-item" href="#incidents">
            <ShieldAlert size={18} />
            Incidents
            {activeIncidents.length > 0 && (
              <span className="nav-count">{activeIncidents.length}</span>
            )}
          </a>
          <a className="nav-item" href="#metrics">
            <Zap size={18} />
            Metrics
          </a>
          <a className="nav-item" href="#services">
            <Server size={18} />
            Services
          </a>
        </nav>

        <div className="sidebar-bottom">
          <div className="system-status">
            <span className="status-dot" />
            <div>
              <strong>Monitoring active</strong>
              <small>Automatic refresh · 15 sec</small>
            </div>
          </div>
          <div className="sidebar-footer">TRACELENS · DEVELOPMENT</div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> <strong>Overview</strong>
          </div>
          <div className="topbar-right">
            <span className="environment"><span className="status-dot" /> Local environment</span>
            <button
              className="icon-button"
              onClick={() => void refresh()}
              disabled={refreshing}
              title="Refresh data"
              aria-label="Refresh data"
            >
              <RefreshCw size={17} className={refreshing ? 'spin' : ''} />
            </button>
            <div className="avatar">TL</div>
          </div>
        </header>

        <section className="page-content" id="overview">
          <div className="page-heading">
            <div>
              <div className="eyebrow">OBSERVABILITY PLATFORM</div>
              <h1>System overview</h1>
              <p>Monitor service health, investigate anomalies, and manage incidents.</p>
            </div>
            <button
              className="primary-button"
              onClick={() => void refresh()}
              disabled={refreshing}
            >
              <RefreshCw size={16} className={refreshing ? 'spin' : ''} />
              Refresh data
            </button>
          </div>

          {error && (
            <div className="error-banner" role="alert">
              <AlertCircle size={19} />
              <div>
                <strong>Could not fully refresh the dashboard</strong>
                <p>{error}</p>
                <small>Check that your backend is running on {API}.</small>
              </div>
              <button className="text-button" onClick={() => void refresh()}>
                Retry
              </button>
            </div>
          )}

          <div className="section-heading">
            <div>
              <h2>Operational health</h2>
              <p>Live snapshot of your monitored environment</p>
            </div>
            <span className="live-indicator"><span className="status-dot" /> LIVE</span>
          </div>

          <div className="stat-grid">
            <StatCard
              title="Registered services"
              value={loading ? '—' : services.length}
              note="Services in registry"
              icon={<Server size={19} />}
              tone="blue"
            />
            <StatCard
              title="Active incidents"
              value={loading ? '—' : activeIncidents.length}
              note="Open or investigating"
              icon={<AlertTriangle size={19} />}
              tone="amber"
            />
            <StatCard
              title="Critical incidents"
              value={loading ? '—' : criticalIncidents.length}
              note="Require priority attention"
              icon={<ShieldAlert size={19} />}
              tone="red"
            />
            <StatCard
              title="Under investigation"
              value={loading ? '—' : investigatingCount}
              note="Currently being investigated"
              icon={<CircleDot size={19} />}
              tone="purple"
            />
          </div>

          <div className="content-grid">
            <section className="panel incident-panel" id="incidents">
              <div className="panel-header">
                <div>
                  <h2>Incident activity</h2>
                  <p>Detected events across your services</p>
                </div>
                <span className="panel-count">{filteredIncidents.length} records</span>
              </div>

              <div className="filter-row">
                {[
                  ['ALL', 'All incidents'],
                  ['ACTIVE', 'Active'],
                  ['CRITICAL', 'Critical'],
                  ['HIGH', 'High'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    className={`filter-button ${filter === value ? 'active' : ''}`}
                    onClick={() => setFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {loading ? (
                <EmptyState title="Loading incidents…" description="Retrieving recent events from the API." />
              ) : filteredIncidents.length === 0 ? (
                <EmptyState title="No matching incidents" description="Incidents will appear here when detection rules are triggered." />
              ) : (
                <div className="incident-list">
                  {filteredIncidents.map((incident) => (
                    <article className="incident-item" key={incident.id}>
                      <div className={`incident-symbol ${incident.severity.toLowerCase()}`}>
                        {incident.severity === 'CRITICAL' || incident.severity === 'HIGH'
                          ? <AlertTriangle size={18} />
                          : <AlertCircle size={18} />}
                      </div>

                      <div className="incident-details">
                        <div className="incident-title-row">
                          <strong>{incident.title}</strong>
                          <span className={`severity-badge ${incident.severity.toLowerCase()}`}>
                            {incident.severity}
                          </span>
                        </div>
                        <div className="incident-meta">
                          <span><Server size={13} /> {incident.service_name}</span>
                          <span><Clock3 size={13} /> {formatDate(incident.detected_at)}</span>
                        </div>
                        {incident.description && (
                          <p className="incident-description">{incident.description}</p>
                        )}
                        <div className="incident-bottom-row">
                          <span className={`status-badge ${incident.status.toLowerCase()}`}>
                            {incident.status.replace('_', ' ')}
                          </span>
                          <div className="incident-actions">
                            {incident.status === 'OPEN' && (
                              <button
                                className="small-button"
                                disabled={updatingId === incident.id}
                                onClick={() => void updateStatus(incident, 'INVESTIGATING')}
                              >
                                Investigate
                              </button>
                            )}
                            {incident.status !== 'RESOLVED' && (
                              <button
                                className="small-button resolve"
                                disabled={updatingId === incident.id}
                                onClick={() => {
                                  if (window.confirm(`Resolve "${incident.title}"?`)) {
                                    void updateStatus(incident, 'RESOLVED');
                                  }
                                }}
                              >
                                <CheckCircle2 size={14} />
                                Resolve
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
              <div className="panel-footer">
                <span>Showing up to 100 recent incidents</span>
                <span>Refreshes every 15 seconds</span>
              </div>
            </section>

            <div className="right-column">
              <section className="panel" id="services">
                <div className="panel-header">
                  <div>
                    <h2>Service registry</h2>
                    <p>Registered application services</p>
                  </div>
                  <Server size={18} className="muted-icon" />
                </div>

                {loading ? (
                  <EmptyState title="Loading services…" description="Reading the service registry." />
                ) : services.length === 0 ? (
                  <EmptyState title="No services found" description="Check the /api/services endpoint." />
                ) : (
                  <div className="service-list">
                    {services.map((service) => (
                      <div className="service-item" key={service.id}>
                        <div className="service-icon"><Server size={17} /></div>
                        <div className="service-name">
                          <strong>{service.name}</strong>
                          <small>ID {service.id}</small>
                        </div>
                        <span className="service-indicator" title="Registered">
                          <CheckCircle2 size={16} />
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="panel-footer">
                  <span>{services.length} registered</span>
                  <span>Registry data</span>
                </div>
              </section>

              <section className="panel metrics-panel" id="metrics">
                <div className="panel-header">
                  <div>
                    <h2>Recent metrics</h2>
                    <p>Latest recorded measurements</p>
                  </div>
                  <Activity size={18} className="muted-icon" />
                </div>

                {loading ? (
                  <EmptyState title="Loading metrics…" description="Retrieving measurements." />
                ) : metrics.length === 0 ? (
                  <EmptyState title="No metrics yet" description="Submit metrics to populate this panel." />
                ) : (
                  <div className="metric-list">
                    {metrics.map((metric) => (
                      <div className="metric-item" key={metric.id}>
                        <div className="metric-top">
                          <span>{formatMetricName(metric.metric_name)}</span>
                          <strong>
                            {Number(metric.value).toLocaleString(undefined, {
                              maximumFractionDigits: 2,
                            })}
                            {metric.metric_name === 'response_time_ms' ? ' ms' : ''}
                          </strong>
                        </div>
                        <div className="metric-bottom">
                          <span>{metric.service_name}</span>
                          <span>{formatDate(metric.recorded_at)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="panel-footer">
                  <span>Latest 10 measurements</span>
                  <span>From PostgreSQL</span>
                </div>
              </section>
            </div>
          </div>

          <footer className="page-footer">
            <span>TraceLens <span className="footer-dot">·</span> Asynchronous API monitoring</span>
            <span>
              {lastUpdated
                ? `Last synced ${lastUpdated.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}`
                : 'Waiting for API'}
            </span>
          </footer>
        </section>
      </main>
    </div>
  );
}

function StatCard({
  title,
  value,
  note,
  icon,
  tone,
}: {
  title: string;
  value: string | number;
  note: string;
  icon: ReactNode;
  tone: string;
}) {
  return (
    <article className="stat-card">
      <div className="stat-top">
        <span className="stat-title">{title}</span>
        <span className={`stat-icon ${tone}`}>{icon}</span>
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-note">
        {tone === 'red' ? (
          <ArrowUpRight size={14} />
        ) : (
          <ArrowDownRight size={14} />
        )}
        {note}
      </div>
    </article>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="empty-state">
      <Activity size={23} />
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

export default App;
