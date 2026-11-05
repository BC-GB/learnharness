import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../../config.ts";
import { eachCourseForMaintenance } from "../store/courses.ts";
import { courseStatePath } from "../runtime/course-context.ts";
import { jobStore } from "../store/jobs.ts";
import { runningTurnCount } from "./turn-liveness.ts";
import { runningCompactionCount } from "./compaction.ts";
import { extractionStatuses } from "../agent/subagents/extraction.ts";
import { liveJobCount } from "../agent/subagents/aborts.ts";

/** Counts only: the installer must see all active courses, while learning
 * APIs never receive another course's titles, records or graph. Deliberately
 * avoids recovery/listJobs service calls that can start model work. */
export interface CourseMaintenanceStatus { courseCount: number; activeTurns: number; compactions: number; extractions: number; backgroundJobs: number }
export function courseMaintenanceStatus(): CourseMaintenanceStatus {
	const courses = eachCourseForMaintenance(() => {
		let backgroundJobs = 0;
		const folder = courseStatePath(path.join(PATHS.data, "jobs"));
		let entries: string[];
		try { entries = fs.readdirSync(folder); }
		catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; entries = []; }
		for (const name of entries) {
			if (!/^[A-Za-z0-9_-]+\.json$/.test(name)) continue;
			const job = jobStore.getJob(name.slice(0, -5));
			if (!job || !["running", "done", "error"].includes(job.status)) throw new Error("Background activity could not be verified.");
			if (job.status === "running") backgroundJobs++;
		}
		return { activeTurns: runningTurnCount(), compactions: runningCompactionCount(), extractions: extractionStatuses().length, backgroundJobs: Math.max(backgroundJobs, liveJobCount()) };
	});
	return courses.reduce<CourseMaintenanceStatus>((total, course) => ({ courseCount: total.courseCount + 1, activeTurns: total.activeTurns + course.activeTurns, compactions: total.compactions + course.compactions, extractions: total.extractions + course.extractions, backgroundJobs: total.backgroundJobs + course.backgroundJobs }), { courseCount: 0, activeTurns: 0, compactions: 0, extractions: 0, backgroundJobs: 0 });
}
