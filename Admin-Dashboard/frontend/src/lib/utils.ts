import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getCourseName(agentName: string): string {
  if (!agentName) return "Course";
  let coursePart = agentName;
  if (agentName.toLowerCase().startsWith("course-")) coursePart = agentName.slice(7);
  else if (agentName.toLowerCase().startsWith("course_")) coursePart = agentName.slice(7);
  else if (agentName.toLowerCase().startsWith("learning-")) coursePart = agentName.slice(9);
  else if (agentName.toLowerCase().startsWith("exam-")) coursePart = agentName.slice(5);
  else if (agentName.toLowerCase().startsWith("learning_")) coursePart = agentName.slice(9);
  else if (agentName.toLowerCase().startsWith("exam_")) coursePart = agentName.slice(5);
  const courseName = coursePart.replace(/[-_]/g, " ").trim();
  const titleCased = courseName
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
  return titleCased || "Course";
}
