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

  addClient(ticketId, res, type) {
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

  // Keep idle SSE connections alive behind proxies (e.g. Render) that
  // drop connections with no traffic for a while.
  startHeartbeat() {
    if (this._hb) return;
    this._hb = setInterval(() => {
      this.clients.forEach((set, ticketId) => {
        set.forEach((client) => {
          try {
            client.write(': ping\n\n');
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
