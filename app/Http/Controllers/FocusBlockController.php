<?php

namespace App\Http\Controllers;

use App\Models\FocusBlock;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class FocusBlockController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $request->validate(['from' => 'required|date', 'to' => 'required|date|after:from']);

        $blocks = $request->user()->focusBlocks()
            ->where('end', '>', $request->date('from'))
            ->where('start', '<', $request->date('to'))
            ->orderBy('start')
            ->get()
            ->map(fn (FocusBlock $block) => $block->toApi());

        return response()->json($blocks);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'title' => 'nullable|string|max:255',
            'start' => 'required|date',
            'end' => 'required|date|after:start',
        ]);

        $block = $request->user()->focusBlocks()->create([
            'title' => $data['title'] ?? 'Focus block',
            'start' => $data['start'],
            'end' => $data['end'],
        ]);

        return response()->json($block->toApi(), 201);
    }

    public function update(Request $request, int $blockId): JsonResponse
    {
        $block = $request->user()->focusBlocks()->whereKey($blockId)->firstOrFail();

        $data = $request->validate([
            'title' => 'sometimes|string|max:255',
            'start' => 'sometimes|date',
            'end' => 'sometimes|date',
        ]);

        $block->update($data);

        return response()->json($block->toApi());
    }

    public function destroy(Request $request, int $blockId): JsonResponse
    {
        $request->user()->focusBlocks()->whereKey($blockId)->firstOrFail()->delete();

        return response()->json(null, 204);
    }
}
