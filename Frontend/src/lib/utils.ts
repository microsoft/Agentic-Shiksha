import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Extract course name from agent name (display-friendly with spaces and proper casing).
 * Handles both underscore and hyphen naming conventions:
 * "learning-deep-learning" → "Deep Learning"
 * "learning_Course_Name" → "Course Name"
 * "exam-data-structures" → "Data Structures"
 * Applies title case to the result.
 */
export function getCourseName(agentName: string): string {
  if (!agentName) return "Course";
  
  // Remove course-, learning- or exam- prefix (hyphen version - new Azure naming)
  let coursePart = agentName;
  if (agentName.toLowerCase().startsWith("course-")) {
    coursePart = agentName.slice(7); // Remove "course-"
  } else if (agentName.toLowerCase().startsWith("course_")) {
    coursePart = agentName.slice(7); // Remove "course_"
  } else if (agentName.toLowerCase().startsWith("learning-")) {
    coursePart = agentName.slice(9); // Remove "learning-"
  } else if (agentName.toLowerCase().startsWith("exam-")) {
    coursePart = agentName.slice(5); // Remove "exam-"
  }
  // Also handle old underscore prefix for backward compatibility
  else if (agentName.toLowerCase().startsWith("learning_")) {
    coursePart = agentName.slice(9); // Remove "learning_"
  } else if (agentName.toLowerCase().startsWith("exam_")) {
    coursePart = agentName.slice(5); // Remove "exam_"
  }
  
  // Replace underscores and hyphens with spaces
  const courseName = coursePart.replace(/[-_]/g, " ").trim();
  
  // Apply title case
  const titleCased = courseName
    .split(" ")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
  
  return titleCased || "Course";
}

/**
 * Extract raw course identifier from agent name (keeps hyphens/underscores).
 * "learning-deep-learning" → "deep-learning"
 * "learning_Course_Name" → "Course_Name"
 * "exam-data-structures" → "data-structures"
 * Used when constructing agent names for API lookups.
 */
export function getCourseId(agentName: string): string {
  if (!agentName) return "";
  
  // Remove learning- or exam- prefix (hyphen version - new Azure naming)
  if (agentName.toLowerCase().startsWith("learning-")) {
    return agentName.slice(9); // Remove "learning-"
  } else if (agentName.toLowerCase().startsWith("exam-")) {
    return agentName.slice(5); // Remove "exam-"
  }
  // Also handle old underscore prefix for backward compatibility
  else if (agentName.toLowerCase().startsWith("learning_")) {
    return agentName.slice(9); // Remove "learning_"
  } else if (agentName.toLowerCase().startsWith("exam_")) {
    return agentName.slice(5); // Remove "exam_"
  }
  
  return agentName;
}

