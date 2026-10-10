import { vi } from "vitest";

export interface MockApiSession {
    id: number;
    start: string;
    end: string;
    note: string;
    pausedMs: number;
    pausedAt: null;
    durationMs: number;
    durationHours: number;
    isActive: boolean;
    dayKey: string;
    createdAt: string;
    updatedAt: string;
}

export interface MockApiDayOff {
    date: string;
    type: "excluded" | "included";
    created_at: string;
}

export const mockSessionsApi = {
    list: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    today: vi.fn(),
    stats: vi.fn(),
    monthly: vi.fn(),
    clearAll: vi.fn(),
};

export const mockDayOffsApi = {
    list: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
};

export const mockAuthApi = {
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    user: vi.fn(),
};

export function setupApiMocks() {
    vi.resetAllMocks();

    return {
        sessionsApi: mockSessionsApi,
        dayOffsApi: mockDayOffsApi,
        authApi: mockAuthApi,
    };
}

export function mockSuccessfulSessionList(sessions: MockApiSession[] = []) {
    mockSessionsApi.list.mockResolvedValue({
        data: { data: sessions },
    });
}

export function mockSuccessfulSessionCreate(session: MockApiSession = {} as MockApiSession) {
    mockSessionsApi.create.mockResolvedValue({ data: session });
}

export function mockSuccessfulSessionUpdate(session: MockApiSession = {} as MockApiSession) {
    mockSessionsApi.update.mockResolvedValue({ data: session });
}

export function mockSuccessfulSessionDelete() {
    mockSessionsApi.delete.mockResolvedValue({});
}

export function mockSuccessfulTodaySessions(sessions: MockApiSession[] = []) {
    mockSessionsApi.today.mockResolvedValue({ data: sessions });
}

export function mockSuccessfulStats(stats = {
    streak: 5,
    weekHours: 40,
    bestDayHours: 10,
    avgPerActiveDay: 8,
    totalHours: 500,
}) {
    mockSessionsApi.stats.mockResolvedValue({ data: stats });
}

export function mockSuccessfulMonthlyBreakdown(months: unknown[] = []) {
    mockSessionsApi.monthly.mockResolvedValue({ data: months });
}

export function mockSuccessfulDayOffsList(dayOffs: MockApiDayOff[] = []) {
    mockDayOffsApi.list.mockResolvedValue({ data: dayOffs });
}

export function mockSuccessfulDayOffCreate(dayOff: MockApiDayOff = {} as MockApiDayOff) {
    mockDayOffsApi.create.mockResolvedValue({ data: dayOff });
}

export function mockSuccessfulDayOffDelete() {
    mockDayOffsApi.delete.mockResolvedValue({});
}

export function mockAuthUser(user = { id: 1, name: "Test User", email: "test@example.com" }) {
    mockAuthApi.user.mockResolvedValue({ data: { user } });
}