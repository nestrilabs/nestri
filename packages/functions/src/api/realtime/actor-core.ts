import { actor } from "actor-core";

// Define a chat room actor
const chatRoom = actor({
  // Initialize state when the actor is first created
  createState: () => ({
    messages: [] as any[],
  }),

  // Define actions clients can call
  actions: {
    // Action to send a message
    sendMessage: (c, sender, text) => {
      // Update state
      c.state.messages.push({ sender, text });
      
      // Broadcast to all connected clients
      c.broadcast("newMessage", { sender, text });
    },
    
    // Action to get chat history
    getHistory: (c) => {
      return c.state.messages;
    }
  }
});

export default chatRoom;