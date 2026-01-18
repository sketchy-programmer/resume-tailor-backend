import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import mammoth from "mammoth";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// CORS Configuration - UPDATED
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://resume-tailor-frontend-dun.vercel.app',
  // Add any other frontend URLs you might use
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Handle preflight requests
app.options('*', cors());

app.use(express.json());

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer configuration
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadsDir),
  filename: (_, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

const upload = multer({
  storage,
  fileFilter: (_, file, cb) => {
    const allowedTypes = [".pdf", ".doc", ".docx", ".txt"];
    const ext = path.extname(file.originalname).toLowerCase();
    allowedTypes.includes(ext)
      ? cb(null, true)
      : cb(new Error("Invalid file type. Only PDF, DOC, DOCX, and TXT allowed."));
  }
});

// OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Extract text from PDF
async function extractTextFromFile(filePath) {
  const data = new Uint8Array(fs.readFileSync(filePath));
  const pdf = await pdfjsLib.getDocument({ data }).promise;

  let text = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(" ") + "\n";
  }

  return text;
}

// Health check
app.get("/api/health", (_, res) => {
  res.json({ status: "ok", message: "Server is running" });
});

// Resume tailoring endpoint
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

    const resumeText = await extractTextFromFile(resumeFile.path);

    const prompt = `
You are a senior resume strategist and recruitment optimization expert.

PRIMARY OBJECTIVE:
Rewrite the resume so it aligns as closely as possible with the job description, prioritizing what the job REQUIRES over how the resume is currently written.

You are allowed to reframe, infer, generalize, and elevate experience so the resume presents the candidate as a strong match for this role, even if certain skills or responsibilities are not explicitly listed in the original resume.

CORE STRATEGY:
- The job description is the source of truth.
- The resume is raw material to be reshaped.
- If the candidate's background reasonably supports a required skill, responsibility, or tool, you should include it using inferred, transferable, or generalized language.

WHAT YOU MAY DO:
- Infer skills from related experience (e.g., backend development implies APIs, debugging, version control).
- Translate academic, project, or personal experience into professional role-aligned language.
- Elevate responsibilities to match the scope of the job description when logically supported.
- Use industry-standard phrasing that recruiters expect for this role.
- Include job-required tools, technologies, or methodologies IF they are a reasonable extension of the candidate's existing experience.
- Reorder, rewrite, and consolidate content to emphasize job relevance above all else.

WHAT YOU MUST NOT DO:
- Do NOT invent employers, job titles, degrees, certifications, or dates.
- Do NOT claim regulated credentials, licenses, or compliance training unless explicitly present.
- Do NOT fabricate exact metrics, years of experience, or seniority levels.
- Do NOT add technologies that would be implausible given the candidate's background.

ATS OPTIMIZATION RULES:
- Use ONLY standard section headings:
  Summary
  Experience
  Education
  Skills
- Use plain text only (no tables, columns, icons, emojis, or markdown).
- Use concise bullet points starting with strong action verbs.
- Mirror the terminology and phrasing used in the job description as closely as possible.
- Optimize for keyword density and placement without keyword stuffing.

PROFESSIONAL SUMMARY REQUIREMENTS:
- Write a role-specific summary that clearly positions the candidate as a strong fit for THIS job.
- Use the job title from the job description (or closest equivalent).
- Highlight the most critical job-required skills and competencies first.
- Avoid generic descriptors (e.g., "hardworking", "motivated").

EXPERIENCE SECTION RULES:
- Rewrite experience bullets to directly support job requirements.
- Prioritize responsibilities and achievements that map to the job description.
- De-emphasize or remove content that does not support this role.
- Each role should contain 4–6 highly targeted bullets.

SKILLS SECTION RULES:
- Build the Skills section to closely reflect the job description.
- Include inferred and transferable skills where logically supported.
- Organize skills in a way that mirrors the job description's structure.

INPUT DATA:

CURRENT RESUME:
${resumeText}

JOB DESCRIPTION:
${jobDescription}

FINAL OUTPUT REQUIREMENTS:
- Return ONLY the tailored resume.
- No explanations, notes, or commentary.
- The resume must read naturally and convincingly to a recruiter.

`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a professional ATS resume writer." },
        { role: "user", content: prompt }
      ],
      temperature: 0.4
    });

    const tailoredResume = response.choices[0].message.content;

    fs.unlinkSync(resumeFile.path);

    res.json({
      success: true,
      tailoredResume
    });

  } catch (error) {
    console.error("Error tailoring resume:", error);

    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      error: "Failed to tailor resume",
      message: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});