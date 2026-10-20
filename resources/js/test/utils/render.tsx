import React, { ReactElement } from "react";
import { render, RenderOptions, RenderResult } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { routeTree } from "@/routeTree.gen";

function createTestContext() {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
                gcTime: 0,
            },
        },
    });

    const router = createRouter({
        routeTree,
        context: { queryClient },
    });

    return { queryClient, router };
}

type TestContext = ReturnType<typeof createTestContext>;

interface WrapperOptions {
    queryClient?: QueryClient;
    router?: TestContext["router"];
    children: React.ReactNode;
}

function TestWrapper({ queryClient, router, children }: WrapperOptions) {
    const ctx = queryClient || router ? { queryClient: queryClient!, router: router! } : createTestContext();

    return (
        <QueryClientProvider client={ctx.queryClient}>
            <ConfirmProvider>{children}</ConfirmProvider>
        </QueryClientProvider>
    );
}

function customRender(
    ui: ReactElement,
    options?: Omit<RenderOptions, "wrapper">
): RenderResult & { testContext: TestContext } {
    const testContext = createTestContext();

    const result = render(ui, {
        wrapper: ({ children }) => (
            <TestWrapper queryClient={testContext.queryClient} router={testContext.router}>
                {children}
            </TestWrapper>
        ),
        ...options,
    });

    return { ...result, testContext };
}

export { customRender as render, createTestContext, TestWrapper };
export type { TestContext };