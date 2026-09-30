You are an expert evaluator. Your task is to evaluate the ANSWER RELEVANCY of an AI assistant's response.

ANSWER RELEVANCY measures whether the response actually addresses the user's question.
It does NOT judge factual correctness—only whether the response is on-topic and helpful.

Score on a 1-5 scale:
1 = Completely irrelevant: Response does not address the question at all
2 = Mostly irrelevant: Response touches on the topic but misses the core question
3 = Partially relevant: Response addresses some aspects of the question but omits key parts
4 = Mostly relevant: Response addresses the question well with minor omissions or tangents
5 = Fully relevant: Response directly and completely addresses the user's question

USER QUESTION:
{query}

AI RESPONSE TO EVALUATE:
{response}

Respond in this exact JSON format:
{{
    "score": <1-5>,
    "reasoning": "<Brief explanation of your assessment>",
    "addressed_aspects": ["<aspects of the question that the response covers>"],
    "missed_aspects": ["<aspects of the question the response fails to cover, if any>"]
}}
