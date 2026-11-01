<?php

namespace App\Http\Controllers;

use App\Models\FocusBlock;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class FocusBlockController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $request->validate(['from' => 'required|date', 'to' => 'required|date|after:from']);

        $blocks = $request->user()->focusBlocks()
            ->with('category')
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
            'category_id' => ['nullable', 'integer', Rule::exists('categories', 'id')->where('user_id', $request->user()->id)],
        ]);

        $block = $request->user()->focusBlocks()->create([
            'category_id' => $data['category_id'] ?? null,
            'title' => $data['title'] ?? 'Focus block',
            'start' => $data['start'],
            'end' => $data['end'],
        ]);

        $block->load('category');

        return response()->json($block->toApi(), 201);
    }

    public function update(Request $request, int $blockId): JsonResponse
    {
        $block = $request->user()->focusBlocks()->whereKey($blockId)->firstOrFail();

        $data = $request->validate([
            'title' => 'sometimes|string|max:255',
            'start' => 'sometimes|date',
            'end' => 'sometimes|date',
            'category_id' => ['sometimes', 'nullable', 'integer', Rule::exists('categories', 'id')->where('user_id', $request->user()->id)],
        ]);

        // Dragging either edge keeps the block sane: the effective start must
        // stay before the effective end even when only one side was sent.
        $start = isset($data['start']) ? Carbon::parse($data['start']) : $block->start;
        $end = isset($data['end']) ? Carbon::parse($data['end']) : $block->end;

        if ($end->lessThanOrEqualTo($start)) {
            throw ValidationException::withMessages(['end' => 'The end must be after the start.']);
        }

        if (array_key_exists('title', $data)) {
            $block->title = $data['title'];
        }

        if (array_key_exists('start', $data)) {
            $block->start = $data['start'];
        }

        if (array_key_exists('end', $data)) {
            $block->end = $data['end'];
        }

        if (array_key_exists('category_id', $data)) {
            $block->category_id = $data['category_id'];
        }

        $block->save();
        $block->load('category');

        return response()->json($block->toApi());
    }

    public function destroy(Request $request, int $blockId): JsonResponse
    {
        $request->user()->focusBlocks()->whereKey($blockId)->firstOrFail()->delete();

        return response()->json(null, 204);
    }
}
