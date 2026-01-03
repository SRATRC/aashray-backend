class TicketStreamManager {
  constructor() {
    // Map<ticketId, Set<res>>
    this.clients = new Map();
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
}

const ticketStreamManager = new TicketStreamManager();
export default ticketStreamManager;
