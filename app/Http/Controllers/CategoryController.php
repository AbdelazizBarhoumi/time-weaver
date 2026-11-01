<?php

namespace App\Http\Controllers;

use App\Models\Category;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class CategoryController extends Controller
{
    /**
     * Every category the user owns, with how many items currently wear it.
     */
    public function index(Request $request): JsonResponse
    {
        $categories = $request->user()->categories()
            ->withCount(['sideTasks', 'focusBlocks', 'eventOverrides', 'defaultAccounts'])
            ->orderBy('name')
            ->get()
            ->map(fn (Category $category): array => $category->toApi(
                $category->side_tasks_count
                    + $category->focus_blocks_count
                    + $category->event_overrides_count
                    + $category->default_accounts_count,
            ));

        return response()->json($categories);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate($this->rules($request));

        $category = $request->user()->categories()->create($data);

        return response()->json($category->toApi(), 201);
    }

    public function update(Request $request, int $categoryId): JsonResponse
    {
        $category = $request->user()->categories()->whereKey($categoryId)->firstOrFail();

        $data = $request->validate($this->rules($request, $category, sometimes: true));

        $category->update($data);

        return response()->json($category->toApi());
    }

    public function destroy(Request $request, int $categoryId): JsonResponse
    {
        $request->user()->categories()->whereKey($categoryId)->firstOrFail()->delete();

        return response()->json(null, 204);
    }

    /**
     * @return array<string, array<int, mixed>>
     */
    private function rules(Request $request, ?Category $category = null, bool $sometimes = false): array
    {
        $required = $sometimes ? 'sometimes' : 'required';
        $uniqueName = Rule::unique('categories', 'name')
            ->where('user_id', $request->user()->id);

        if ($category !== null) {
            $uniqueName->ignore($category->id);
        }

        return [
            'name' => [$required, 'string', 'max:60', $uniqueName],
            'color' => [$required, 'string', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'icon' => [$required, 'string', Rule::in(Category::ICONS)],
            'style' => [$required, 'string', Rule::in(Category::STYLES)],
        ];
    }
}
