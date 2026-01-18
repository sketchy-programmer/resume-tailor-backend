import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import OpenAI from "openai";
import mammoth from "mammoth";
import { createRequire } from "module";
const require = createRequire(import.meta.url);

const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.cjs");



dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

/* =========================
   CORS CONFIG
========================= */
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3001",
  "https://resume-tailor-frontend-dun.vercel.app",
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // allow server-to-server
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.options("*", cors());
app.use(express.json());

/* =========================
   MULTER (MEMORY STORAGE)
========================= */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_, file, cb) => {
    const allowed = [".pdf", ".doc", ".docx", ".txt"];
    const ext = file.originalname
      .toLowerCase()
      .slice(file.originalname.lastIndexOf("."));
    allowed.includes(ext)
      ? cb(null, true)
      : cb(new Error("Only PDF, DOC, DOCX, TXT allowed"));
  },
});

/* =========================
   OPENAI CLIENT
========================= */
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/* =========================
   PDF TEXT EXTRACTION
   (SERVERLESS SAFE)
========================= */
async function extractTextFromPDF(buffer) {
  const data = new Uint8Array(buffer);

  const pdf = await pdfjsLib.getDocument({
    data,
    disableWorker: true
  }).promise;

  let text = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(" ") + "\n";
  }

  return text;
}

/* =========================
   GENERIC FILE TEXT EXTRACT
========================= */
async function extractTextFromBuffer(buffer, filename) {
  const ext = filename.toLowerCase().slice(filename.lastIndexOf("."));

  if (ext === ".pdf") {
    return await extractTextFromPDF(buffer);
  }

  if (ext === ".doc" || ext === ".docx") {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (ext === ".txt") {
    return buffer.toString("utf-8");
  }

  throw new Error("Unsupported file type");
}

/* =========================
   HEALTH CHECK
========================= */
app.get("/api/health", (_, res) => {
  res.json({ status: "ok", message: "Server is running" });
});

/* =========================
   MAIN API
========================= */
app.post("/api/tailor-resume", upload.single("resume"), async (req, res) => {
  try {
    const { jobDescription } = req.body;
    const resumeFile = req.file;

    if (!resumeFile) {
      return res.status(400).json({ error: "Resume file is required" });
    }

    if (!jobDescription) {
      return res.status(400).json({ error: "Job description is required" });
    }

    const resumeText = await extractTextFromBuffer(
      resumeFile.buffer,
      resumeFile.originalname
    );

    if (!resumeText.trim()) {
      return res
        .status(400)
        .json({ error: "Could not extract text from resume" });
    }

    const prompt = `
You are a senior resume strategist and recruitment optimization expert.

Rewrite the resume so it aligns as closely as possible with the job description.
Use ONLY these headings: Summary, Experience, Education, Skills.
Plain text only. No markdown. No commentary.

CURRENT RESUME:
${resumeText}

JOB DESCRIPTION:
${jobDescription}

Return ONLY the tailored resume.
`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a professional ATS resume writer." },
        { role: "user", content: prompt },
      ],
      temperature: 0.4,
    });

    res.json({
      success: true,
      tailoredResume: response.choices[0].message.content,
    });
  } catch (error) {
    console.error("Resume tailoring error:", error);
    res.status(500).json({
      error: "Failed to tailor resume",
      message: error.message,
    });
  }
});

/* =========================
   EXPORT FOR VERCEL
========================= */
export default function handler(req, res) {
  return app(req, res);
}

