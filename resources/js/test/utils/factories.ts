import type { WorkSession } from "@/lib/tracker";
import type { CustomDayOff } from "@/lib/tracker";

export function createMockSession(overrides: Partial<WorkSession> = {}): WorkSession {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 17, 0);

    return {
        id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        start: start.toISOString(),
        end: end.toISOString(),
        note: "Test session",
        pausedMs: 0,
        pausedAt: null,
        segments: [{ type: "work", start: start.toISOString(), end: end.toISOString() }],
        segmentsInferred: false,
        ...overrides,
    };
}

export function createMockSessions(count: number, overrides: Partial<WorkSession> = {}): WorkSession[] {
    const sessions: WorkSession[] = [];
    const baseDate = new Date();

    for (let i = 0; i < count; i++) {
        const date = new Date(baseDate);
        date.setDate(date.getDate() - i);

        const start = new Date(date);
        start.setHours(9, 0, 0, 0);
        const end = new Date(date);
        end.setHours(17, 0, 0, 0);

        sessions.push({
            id: `session-${i}`,
            start: start.toISOString(),
            end: end.toISOString(),
            note: `Session ${i}`,
            pausedMs: 0,
            pausedAt: null,
            segments: [{ type: "work", start: start.toISOString(), end: end.toISOString() }],
            segmentsInferred: false,
            ...overrides,
        });
    }

    return sessions;
}

function getDateKey(): string {
    return new Date().toISOString().split("T")[0] ?? "";
}

export function createMockDayOff(overrides: Partial<CustomDayOff> = {}): CustomDayOff {
    const base: CustomDayOff = {
        date: getDateKey(),
        type: "excluded",
    };
    return { ...base, ...overrides };
}

export function createMockDayOffs(count: number, overrides: Partial<CustomDayOff> = {}): CustomDayOff[] {
    const dayOffs: CustomDayOff[] = [];
    const baseDate = new Date();

    for (let i = 0; i < count; i++) {
        const date = new Date(baseDate);
        date.setDate(date.getDate() - i * 7);

        const dayOff: CustomDayOff = {
            date: date.toISOString().split("T")[0] ?? "",
            type: i % 2 === 0 ? "excluded" : "included",
            ...overrides,
        };
        dayOffs.push(dayOff);
    }

    return dayOffs;
}

export function createApiSession(overrides: Record<string, unknown> = {}) {
    return {
        id: 1,
        start: new Date().toISOString(),
        end: new Date().toISOString(),
        note: "Test session",
        pausedMs: 0,
        pausedAt: null,
        segments: [{ type: "work" as const, start: new Date().toISOString(), end: new Date().toISOString() }],
        segmentsInferred: false,
        durationMs: 28800000,
        durationHours: 8,
        isActive: false,
        dayKey: new Date().toISOString().split("T")[0],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...overrides,
    };
}

export function createApiSessions(count: number) {
    return Array.from({ length: count }, (_, i) => createApiSession({ id: i + 1 }));
}

export function createApiDayOff(overrides: Record<string, unknown> = {}) {
    return {
        date: new Date().toISOString().split("T")[0],
        type: "excluded",
        created_at: new Date().toISOString(),
        ...overrides,
    };
}