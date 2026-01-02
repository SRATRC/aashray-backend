import { Server } from 'socket.io';

let io;

export const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: '*', // restrict later if needed
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', socket => {
    console.log('Admin connected:', socket.id);

    socket.on('join_admin', () => {
      socket.join('admins');
    });

    socket.on('disconnect', () => {
      console.log('Disconnected:', socket.id);
    });
  });

  return io;
};

export const getIO = () => {
  if (!io) {
    throw new Error('Socket.io not initialized');
  }
  return io;
};
