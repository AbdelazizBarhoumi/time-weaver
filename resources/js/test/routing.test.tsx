import { describe, it, expect, vi } from "vitest";
import { createRouter } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import { routeTree } from "@/routeTree.gen";
import { rootRouteId } from "@tanstack/react-router";

describe("App routing", () => {
    it("matches a page for / instead of falling back to not found", () => {
        const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
        const matches = router.matchRoutes("/");
        expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
    });

    it("matches /day/YYYY-MM-DD route", () => {
        const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
        const matches = router.matchRoutes("/day/2026-10-07");
        expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
        expect(matches.some(m => m.routeId.includes("day"))).toBe(true);
    });

    it("extracts dateKey from day route", () => {
        const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
        const matches = router.matchRoutes("/day/2026-10-07");
        const dayMatch = matches.find(m => m.routeId.includes("day"));
        expect(dayMatch?.params?.dateKey).toBe("2026-10-07");
    });

    it("matches day route even with invalid date format (params validation happens at load time)", () => {
        const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
        const matches = router.matchRoutes("/day/invalid-date");
        // The route matches but params will fail validation in the loader
        const dayMatch = matches.find(m => m.routeId.includes("day"));
        expect(dayMatch).toBeDefined();
        expect(dayMatch?.params?.dateKey).toBe("invalid-date");
    });

    it("matches login route", () => {
        const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
        const matches = router.matchRoutes("/login");
        expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
    });
});