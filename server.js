const express = require("express")
const http = require("http")
const socketIo = require("socket.io")
const cors = require("cors")

const app = express()
const server = http.createServer(app)
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
  },
})

app.use(cors())
app.use(express.json())

// In-memory storage (in production, use a database)
let currentPoll = null
const participants = new Map()
const chatMessages = []
const pollHistory = []
const pollResponses = new Map()

// Socket.io connection handling
io.on("connection", (socket) => {
  console.log("User connected:", socket.id)

  // Handle teacher joining
  socket.on("join-as-teacher", () => {
    socket.join("teachers")
    socket.emit("teacher-joined", {
      currentPoll,
      participants: Array.from(participants.values()),
      chatMessages,
      pollHistory,
    })
  })

  // Handle student joining
  socket.on("join-as-student", (studentData) => {
    const participant = {
      id: socket.id,
      name: studentData.name,
      isActive: true,
      joinedAt: new Date(),
    }

    participants.set(socket.id, participant)
    socket.join("students")

    // Notify teachers about new participant
    io.to("teachers").emit("participant-joined", participant)

    // Send current state to student
    socket.emit("student-joined", {
      currentPoll,
      chatMessages,
      hasAnswered: pollResponses.has(socket.id),
    })
  })

  // Handle poll creation
  socket.on("create-poll", (pollData) => {
    currentPoll = {
      id: Date.now().toString(),
      question: pollData.question,
      options: pollData.options,
      correctAnswers: pollData.correctAnswers,
      timer: pollData.timer,
      createdAt: new Date(),
      isActive: true,
      responses: {},
      totalResponses: 0,
    }

    // Clear previous responses
    pollResponses.clear()

    // Broadcast to all users
    io.emit("poll-created", currentPoll)

    // Start timer
    setTimeout(() => {
      if (currentPoll && currentPoll.id === pollData.id) {
        currentPoll.isActive = false
        pollHistory.push({ ...currentPoll })
        io.emit("poll-ended", currentPoll)
      }
    }, pollData.timer * 1000)
  })

  // Handle poll response
  socket.on("submit-answer", (answerData) => {
    if (!currentPoll || !currentPoll.isActive || pollResponses.has(socket.id)) {
      return
    }

    const participant = participants.get(socket.id)
    if (!participant || !participant.isActive) {
      return
    }

    // Record response
    pollResponses.set(socket.id, answerData.optionIndex)

    // Update poll responses
    if (!currentPoll.responses[answerData.optionIndex]) {
      currentPoll.responses[answerData.optionIndex] = 0
    }
    currentPoll.responses[answerData.optionIndex]++
    currentPoll.totalResponses++

    // Broadcast updated results to teachers
    io.to("teachers").emit("poll-updated", currentPoll)

    // Send confirmation to student
    socket.emit("answer-submitted", {
      success: true,
      currentPoll,
    })

    // Check if all students have answered
    const activeStudents = Array.from(participants.values()).filter((p) => p.isActive).length
    if (currentPoll.totalResponses >= activeStudents) {
      currentPoll.isActive = false
      pollHistory.push({ ...currentPoll })
      io.emit("poll-ended", currentPoll)
    }
  })

  // Handle chat message
  socket.on("send-message", (messageData) => {
    const participant = participants.get(socket.id)
    if (!participant) return

    const message = {
      id: Date.now().toString(),
      userId: socket.id,
      userName: participant.name,
      message: messageData.message,
      timestamp: new Date(),
    }

    chatMessages.push(message)
    io.emit("new-message", message)
  })

  // Handle kick out student
  socket.on("kick-student", (studentId) => {
    const participant = participants.get(studentId)
    if (participant) {
      participant.isActive = false
      participants.set(studentId, participant)

      // Notify the kicked student
      io.to(studentId).emit("kicked-out")

      // Notify teachers
      io.to("teachers").emit("participant-updated", participant)
    }
  })

  // Handle disconnect
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id)

    const participant = participants.get(socket.id)
    if (participant) {
      participant.isActive = false
      participants.set(socket.id, participant)
      io.to("teachers").emit("participant-updated", participant)
    }
  })
})

// REST API endpoints
app.get("/api/poll-history", (req, res) => {
  res.json(pollHistory)
})

app.get("/api/current-poll", (req, res) => {
  res.json(currentPoll)
})

const PORT = process.env.PORT || 5000
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
