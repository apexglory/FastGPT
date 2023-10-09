import { sseResponseEventEnum, TaskResponseKeyEnum } from '@/constants/chat';
import { getErrText } from '@/utils/tools';
import { parseStreamChunk, SSEParseData } from '@/utils/sse';
import type { ChatHistoryItemResType } from '@/types/chat';
import { StartChatFnProps } from '@/components/ChatBox';
import { getToken } from '@/utils/user';

interface StreamFetchProps {
  url?: string;
  data: Record<string, any>;
  onMessage: StartChatFnProps['generatingMessage'];
  abortSignal: AbortController;
  isShadow?: boolean;
}

export const streamFetch = ({
  url = '/api/v1/chat/completions',
  data,
  onMessage,
  abortSignal,
  isShadow
}: StreamFetchProps) =>
  new Promise<{
    responseText: string;
    [TaskResponseKeyEnum.responseData]: ChatHistoryItemResType[];
  }>(async (resolve, reject) => {
    try {
      let response: any;
      if (isShadow) {
        response = await window.fetch('http://127.0.0.1:5000/user_query', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            user_input: data.messages[0].content,
            kb_name: 'test_kb'
          })
        });
      } else {
        response = await window.fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            token: getToken()
          },
          signal: abortSignal.signal,
          body: JSON.stringify({
            ...data,
            detail: true,
            stream: true
          })
        });
      }

      if (!response?.body) {
        throw new Error('Request Error');
      }

      const reader = response.body?.getReader();

      // response data
      let responseText = '';
      let errMsg = '';
      let responseData: ChatHistoryItemResType[] = [];

      const parseData = new SSEParseData();

      const read = async () => {
        try {
          const { done, value } = await reader.read();
          if (done) {
            if (response.status === 200 && !errMsg) {
              return resolve({
                responseText,
                responseData
              });
            } else {
              return reject({
                message: errMsg || '响应过程出现异常~',
                responseText
              });
            }
          }
          const chunkResponse = parseStreamChunk(value);
          console.log('chunkResponse', chunkResponse);
          chunkResponse.forEach((item) => {
            // parse json data
            const { eventName, data } = parseData.parse(item);

            if (!eventName || !data) return;

            if (eventName === sseResponseEventEnum.answer && data !== '[DONE]') {
              const answer: string = data?.choices?.[0]?.delta?.content || '';
              onMessage({ text: answer });
              responseText += answer;
            } else if (
              eventName === sseResponseEventEnum.moduleStatus &&
              data?.name &&
              data?.status
            ) {
              onMessage(data);
            } else if (
              eventName === sseResponseEventEnum.appStreamResponse &&
              Array.isArray(data)
            ) {
              responseData = data;
            } else if (eventName === sseResponseEventEnum.error) {
              errMsg = getErrText(data, '流响应错误');
            }
          });
          read();
        } catch (err: any) {
          if (err?.message === 'The user aborted a request.') {
            return resolve({
              responseText,
              responseData
            });
          }
          reject({
            responseText,
            message: getErrText(err, '请求异常')
          });
        }
      };
      read();
    } catch (err: any) {
      console.log(err, 'fetch error');

      reject(getErrText(err, '请求异常'));
    }
  });
