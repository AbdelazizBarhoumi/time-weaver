<?php

namespace App\Http\Controllers;

use App\Http\Resources\ReportPresetResource;
use App\Models\ReportPreset;
use App\Services\ReportConfig;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class ReportPresetController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $presets = $request->user()->reportPresets()
            ->orderByDesc('is_default')
            ->orderBy('name')
            ->get();

        return response()->json(ReportPresetResource::collection($presets)->resolve());
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => [
                'required',
                'string',
                'max:120',
                Rule::unique('report_presets')->where('user_id', $request->user()->id),
            ],
            'config' => ['required', 'array'],
            'isDefault' => ['sometimes', 'boolean'],
        ]);

        $config = $this->validateConfig($data['config']);
        $user = $request->user();
        $isDefault = (bool) ($data['isDefault'] ?? ! $user->reportPresets()->exists());

        $preset = DB::transaction(function () use ($user, $data, $config, $isDefault): ReportPreset {
            if ($isDefault) {
                $user->reportPresets()->update(['is_default' => false]);
            }

            return $user->reportPresets()->create([
                'name' => $data['name'],
                'config' => $config,
                'is_default' => $isDefault,
            ]);
        });

        return response()->json((new ReportPresetResource($preset))->resolve(), 201);
    }

    public function update(Request $request, int $preset): JsonResponse
    {
        $record = $request->user()->reportPresets()->findOrFail($preset);

        $data = $request->validate([
            'name' => [
                'sometimes',
                'required',
                'string',
                'max:120',
                Rule::unique('report_presets')
                    ->where('user_id', $request->user()->id)
                    ->ignore($record->id),
            ],
            'config' => ['sometimes', 'array'],
            'isDefault' => ['sometimes', 'boolean'],
        ]);

        $config = isset($data['config']) ? $this->validateConfig($data['config']) : null;

        DB::transaction(function () use ($request, $record, $data, $config): void {
            if (($data['isDefault'] ?? false) === true) {
                $request->user()->reportPresets()->whereKeyNot($record->id)->update(['is_default' => false]);
            }

            $record->fill(array_filter([
                'name' => $data['name'] ?? null,
                'config' => $config,
            ], fn (mixed $value): bool => $value !== null));

            if (array_key_exists('isDefault', $data)) {
                $record->is_default = (bool) $data['isDefault'];
            }

            $record->save();
        });

        return response()->json((new ReportPresetResource($record->fresh()))->resolve());
    }

    public function destroy(Request $request, int $preset): JsonResponse
    {
        $record = $request->user()->reportPresets()->findOrFail($preset);
        $record->delete();

        return response()->json(['deleted' => true]);
    }

    /**
     * Validate the builder options while intentionally leaving out the dates and
     * time zone, so a saved preset can be reused for another period.
     *
     * @param  array<string, mixed>  $config
     * @return array<string, mixed>
     */
    private function validateConfig(array $config): array
    {
        $rules = ReportConfig::rules();
        unset($rules['from'], $rules['to'], $rules['timezone']);

        /** @var Validator $validator */
        $validator = validator($config, $rules);

        return $validator->validate();
    }
}
