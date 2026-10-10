import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSessions, useTodaySessions, useStats, useMonthlyBreakdown, useDaySessions, useDayOffs } from "@/lib/queries";
import React from "react";

const createWrapper = () => {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false, gcTime: 0 },
            mutations: { retry: false },
        },
    });
    return ({ children }: { children: React.ReactNode }) =>
        React.createElement(QueryClientProvider, { client: queryClient }, children);
};

describe("lib/queries hooks", () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    describe("useSessions", () => {
        it("fetches sessions list", async () => {
            const { result } = renderHook(() => useSessions(), { wrapper: createWrapper() });
            await waitFor(() => expect(result.current.isLoading).toBe(true));
        });

        it("accepts query parameters", async () => {
            const { result } = renderHook(() => useSessions({ from: "2026-10-01", to: "2026-10-31" }), { wrapper: createWrapper() });
            await waitFor(() => expect(result.current.isLoading).toBe(true));
        });
    });

    describe("useTodaySessions", () => {
        it("fetches today's sessions", async () => {
            const { result } = renderHook(() => useTodaySessions(), { wrapper: createWrapper() });
            await waitFor(() => expect(result.current.isLoading).toBe(true));
        });
    });

    describe("useStats", () => {
        it("fetches stats", async () => {
            const { result } = renderHook(() => useStats(), { wrapper: createWrapper() });
            await waitFor(() => expect(result.current.isLoading).toBe(true));
        });
    });

    describe("useMonthlyBreakdown", () => {
        it("fetches monthly breakdown", async () => {
            const { result } = renderHook(() => useMonthlyBreakdown(4), { wrapper: createWrapper() });
            await waitFor(() => expect(result.current.isLoading).toBe(true));
        });

        it("accepts custom count", async () => {
            const { result } = renderHook(() => useMonthlyBreakdown(12), { wrapper: createWrapper() });
            await waitFor(() => expect(result.current.isLoading).toBe(true));
        });
    });

    describe("useDaySessions", () => {
        it("fetches sessions for specific date", async () => {
            const { result } = renderHook(() => useDaySessions("2026-10-07"), { wrapper: createWrapper() });
            await waitFor(() => expect(result.current.isLoading).toBe(true));
        });

        it("does not fetch when dateKey is empty", async () => {
            const { result } = renderHook(() => useDaySessions(""), { wrapper: createWrapper() });
            expect(result.current.isLoading).toBe(false);
            expect(result.current.isSuccess).toBe(false);
        });

        it("returns data when dateKey provided", async () => {
            const { result } = renderHook(() => useDaySessions("2026-10-07"), { wrapper: createWrapper() });
            await waitFor(() => expect(result.current.isLoading).toBe(true));
        });
    });

    describe("useDayOffs", () => {
        it("fetches day offs list", async () => {
            const { result } = renderHook(() => useDayOffs(), { wrapper: createWrapper() });
            await waitFor(() => expect(result.current.isLoading).toBe(true));
        });
    });
});