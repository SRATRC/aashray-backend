// In-memory SSE broadcaster for ticket conversations (single-instance).
// Scaling note: for multi-instance deployments, replace this in-memory
// Map<ticketId, Set<res>> with a Redis pub/sub fan-out — publish the
// message on write, and have each instance forward it to its own local
// subscribers (this class's `broadcastMessage` would become the local
// subscriber callback).
class TicketStreamManager {
  constructor() {
    // Map<ticketId, Set<res>>
    this.clients = new Map();
    this.startHeartbeat();
  }

  // Returns false when the stream was refused (server shutting down); the
  // caller must not write to it.
  addClient(ticketId, res, type) {
    // Shutting down: end the stream now so it can't hold server.close() open.
    if (this._closed) {
      res.end();
      return false;
    }
    if (!this.clients.has(ticketId)) {
      this.clients.set(ticketId, new Set());
    }
    const clients = this.clients.get(ticketId);
    clients.add(res);

    // Context for logging or debugging
    res.locals = res.locals || {};
    res.locals.streamType = type;

    // Remove client on close
    res.on('close', () => {
      this.removeClient(ticketId, res);
    });
    return true;
  }

  removeClient(ticketId, res) {
    if (this.clients.has(ticketId)) {
      const clients = this.clients.get(ticketId);
      clients.delete(res);
      if (clients.size === 0) {
        this.clients.delete(ticketId);
      }
    }
  }

  broadcastMessage(ticketId, message) {
    if (this.clients.has(ticketId)) {
      const clients = this.clients.get(ticketId);
      const data = `data: ${JSON.stringify(message)}\n\n`;
      clients.forEach((client) => {
        try {
          client.write(data);
        } catch (e) {
          this.removeClient(ticketId, client);
        }
      });
    }
  }

  // A status change isn't always paired with a new message (e.g. an admin
  // picking "Resolved" from the dropdown, or a user tapping "Close Ticket")
  // — without this, connected clients would have no live way to learn the
  // ticket moved and would only see it after a manual reload.
  broadcastStatusUpdate(ticketId, status, updatedBy) {
    this.broadcastMessage(ticketId, { type: 'status_update', status, updatedBy });
  }

  // Ends every open stream. Called on shutdown: an open SSE response keeps
  // server.close() waiting until the process is killed.
  closeAll() {
    this._closed = true;
    clearInterval(this._hb);
    this._hb = null;
    this.clients.forEach((set) =>
      set.forEach((client) => {
        try {
          client.end();
        } catch (e) {
          // already gone
        }
      })
    );
    this.clients.clear();
  }

  // Keep idle SSE connections alive behind proxies (e.g. Render) that
  // drop connections with no traffic for a while.
  //
  // Sent as a real `data:` frame carrying {type:'ping'} rather than a raw
  // SSE comment line (`: ping`): some clients (e.g. react-native-sse) never
  // surface comment lines to application code at all, which means a client
  // has no way to notice a connection has silently gone stale (a graceful
  // close produces no error event either). A real data frame lets clients
  // treat "no ping in N seconds" as a liveness check and reconnect proactively.
  startHeartbeat() {
    if (this._hb) return;
    this._hb = setInterval(() => {
      const ping = `data: ${JSON.stringify({ type: 'ping' })}\n\n`;
      this.clients.forEach((set, ticketId) => {
        set.forEach((client) => {
          try {
            client.write(ping);
          } catch (e) {
            this.removeClient(ticketId, client);
          }
        });
      });
    }, 25000);
    if (this._hb.unref) this._hb.unref();
  }
}

const ticketStreamManager = new TicketStreamManager();
export default ticketStreamManager;
