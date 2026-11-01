<?php

namespace Database\Factories;

use App\Models\Category;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Category>
 */
class CategoryFactory extends Factory
{
    protected $model = Category::class;

    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'name' => ucfirst(fake()->unique()->words(2, true)),
            'color' => fake()->randomElement(['#5b9cff', '#a78bfa', '#f472b6', '#f87171', '#fcd34d', '#34d399', '#22d3ee', '#94a3b8']),
            'icon' => fake()->randomElement(Category::ICONS),
            'style' => fake()->randomElement(Category::STYLES),
        ];
    }
}
